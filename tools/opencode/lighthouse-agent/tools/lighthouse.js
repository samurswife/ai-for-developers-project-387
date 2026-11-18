import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createAuditIssueClient, findRecordedIssue, isDemoIssue } from '../publication.mjs';

const decisions = ['no-findings', 'duplicate', 'new-finding'];
const contextLimitBytes = 40_000;

function validateDecision(input, report, issues) {
  const { status, auditId, issueNumber, summary, proposedAction } = input;
  if (
    !decisions.includes(status) ||
    typeof auditId !== 'string' ||
    !Number.isSafeInteger(issueNumber) ||
    typeof summary !== 'string' ||
    !summary.trim() ||
    summary.length > 600 ||
    typeof proposedAction !== 'string' ||
    proposedAction.length > 400
  ) {
    throw new Error('Invalid decision fields.');
  }
  if (status === 'no-findings') {
    if (report.findings.length || auditId || issueNumber !== 0 || proposedAction) {
      throw new Error('No-findings requires an empty shortlist and no issue or action.');
    }
  } else if (!report.findings.some((finding) => finding.auditId === auditId)) {
    throw new Error('The selected audit ID is absent from the report.');
  } else if (status === 'duplicate') {
    if (!issues.some((issue) => issue.number === issueNumber) || proposedAction) {
      throw new Error('A duplicate requires a matching issue from the retrieved list.');
    }
  } else if (issueNumber !== 0 || !proposedAction.trim()) {
    throw new Error('A new finding requires a proposed action and no existing issue number.');
  }
  return {
    status,
    mode: report.mode,
    auditId,
    issueNumber,
    summary: summary.trim(),
    proposedAction: proposedAction.trim(),
  };
}

export function createAuditTools({ env = process.env, request = fetch } = {}) {
  let contextForDecision;
  let publicationStarted = false;
  const context = {
    description: 'Read the Lighthouse shortlist and existing GitHub Issues for this audit mode.',
    args: {},
    async execute() {
      contextForDecision = undefined;
      const directory = join(env.RUNNER_TEMP, 'lighthouse-analysis');
      const report = JSON.parse(await readFile(join(directory, 'report', 'summary.json'), 'utf8'));
      const target = URL.parse(report?.appUrl ?? '');
      if (
        report?.status !== 'collected' ||
        report.mode !== env.AUDIT_MODE ||
        !['live', 'demo'].includes(report.mode) ||
        report.profile !== 'mobile' ||
        !Array.isArray(report.findings) ||
        !Array.isArray(report.performanceScores) ||
        report.performanceScores.length !== 3 ||
        !report.performanceScores.every(
          (score) => Number.isFinite(score) && score >= 0 && score <= 1,
        ) ||
        target?.protocol !== 'https:' ||
        target.username ||
        target.password ||
        target.search ||
        target.hash ||
        report.findings.some(
          ({ auditId, medianSavingsMs }) =>
            !/^[a-z0-9-]+-insight$/.test(auditId) || !Number.isFinite(medianSavingsMs),
        )
      ) {
        throw new Error('A Lighthouse summary from this run is required.');
      }
      const client = createAuditIssueClient(env, request);
      const fetched = report.findings.length ? await client.listIssues() : [];
      const recordedIssues = report.findings
        .map(({ auditId }) => ({
          auditId,
          number: findRecordedIssue(fetched, report, auditId)?.number,
        }))
        .filter(({ number }) => number !== undefined);
      const issues = fetched
        .filter((issue) => isDemoIssue(issue) === (report.mode === 'demo'))
        .map(({ number, state, title, body }) => ({
          number,
          state,
          title: title.slice(0, 200),
          bodyPreview: (body ?? '').slice(0, 350),
        }));
      const data = JSON.stringify({ report, issues, recordedIssues });
      if (Buffer.byteLength(data) > contextLimitBytes) {
        throw new Error('The Lighthouse and issue context exceeds the supported size.');
      }
      contextForDecision = { client, directory, report, issues };
      return data;
    },
  };
  const decide = {
    description: 'Publish one validated audit decision and return its GitHub result.',
    args: {
      status: { type: 'string', enum: decisions },
      auditId: { type: 'string', description: 'ID from the report; empty for no-findings.' },
      issueNumber: {
        type: 'integer',
        description: 'Existing issue number for duplicate; otherwise 0.',
      },
      summary: {
        type: 'string',
        description: 'Short conclusion in Russian, up to 600 characters.',
      },
      proposedAction: {
        type: 'string',
        description: 'Specific next action for new-finding; otherwise empty.',
      },
    },
    async execute(input) {
      if (!contextForDecision) throw new Error('Call lighthouse_context successfully first.');
      if (publicationStarted)
        throw new Error('A publication has already been attempted for this run.');
      const { client, directory, report, issues } = contextForDecision;
      const decision = validateDecision(input, report, issues);
      // Claim the attempt before making a request. A failed response can follow a successful POST.
      publicationStarted = true;
      const publication = await client.publish(decision, report);
      const result = { ...decision, publication };
      await writeFile(join(directory, 'decision.json'), `${JSON.stringify(result, null, 2)}\n`, {
        flag: 'wx',
      });
      return JSON.stringify(publication);
    },
  };
  return { context, decide };
}

/** @public OpenCode discovers these exports at runtime. */
export const { context, decide } = createAuditTools();
