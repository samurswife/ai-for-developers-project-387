import { createHash } from 'node:crypto';

const demoTitlePrefix = '[Учебный аудит]';
const actionsBot = 'github-actions[bot]';
const pageSize = 100;
const findingMarker = '<!-- lighthouse-audit:finding:';

function marker(report, kind, auditId = '') {
  const url = new URL(report.appUrl);
  const key = JSON.stringify([url.origin, url.pathname, report.profile, report.mode, auditId]);
  const digest = createHash('sha256').update(key).digest('hex');
  return `<!-- lighthouse-audit:${kind}:${report.mode}:${digest} -->`;
}

function carriesMarker(entry, expected) {
  return entry.user?.login === actionsBot && entry.body?.includes(expected);
}

export function findRecordedIssue(issues, report, auditId) {
  const expected = marker(report, 'finding', auditId);
  return issues.find((issue) => carriesMarker(issue, expected));
}

export function isDemoIssue(issue) {
  if (issue.user?.login === actionsBot && issue.body?.includes(findingMarker)) {
    return issue.body.includes(`${findingMarker}demo:`);
  }
  return issue.title.startsWith(demoTitlePrefix);
}

function markdownText(text) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '@': '&#64;', '#': '&#35;' };
  return text
    .replace(/\s+/g, ' ')
    .replace(/[&<>@#]/g, (character) => entities[character])
    .replace(/[\\`*_[\]]/g, '\\$&');
}

function findingIssue(decision, report, runUrl) {
  const finding = report.findings.find(({ auditId }) => auditId === decision.auditId);
  const demo = report.mode === 'demo';
  const prefix = demo ? demoTitlePrefix : '[Lighthouse]';
  const title = `${prefix} ${finding.title ?? finding.auditId}`.replace(/\s+/g, ' ').slice(0, 180);
  const body = [
    marker(report, 'finding', finding.auditId),
    ...(demo ? ['', '**Учебная находка. Замеры приложения не выполнялись.**'] : []),
    '',
    '## Проблема',
    '',
    markdownText(decision.summary),
    '',
    '## Предлагаемое действие',
    '',
    markdownText(decision.proposedAction),
    '',
    '## Данные Lighthouse',
    '',
    `Сервис «Запись на звонок», [главная страница](<${report.appUrl}>), мобильный профиль.`,
    `Проверка \`${finding.auditId}\`. Медианная оценка экономии FCP или LCP — ${Math.round(finding.medianSavingsMs)} мс.`,
    `Оценки Performance по трём замерам — ${report.performanceScores.map((score) => Math.round(score * 100)).join(', ')} из 100.`,
    '',
    `[Прогон и исходный отчёт Lighthouse](${runUrl})`,
  ].join('\n');
  return { title, body, labels: demo ? [] : ['needs-triage'] };
}

export function createAuditIssueClient(env, request) {
  const {
    GITHUB_REPOSITORY: repository,
    GITHUB_API_URL: apiUrl,
    GITHUB_SERVER_URL: serverUrl,
    GITHUB_TOKEN: token,
    GITHUB_RUN_ID: runId,
    AUDIT_TRACKING_ISSUE: trackingIssue,
  } = env;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !apiUrl || !token) {
    throw new Error('GitHub Issues credentials are unavailable.');
  }
  const repoApi = new URL(`repos/${repository}/`, `${apiUrl}/`);
  const repoUrl = `${serverUrl}/${repository}`;

  async function send(path, payload) {
    const write = payload !== undefined;
    const response = await request(new URL(path, repoApi).href, {
      method: write ? 'POST' : 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        ...(write ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(write ? { body: JSON.stringify(payload) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if ((write && response.status !== 201) || (!write && !response.ok)) {
      throw new Error(
        `Could not ${write ? 'publish' : 'read'} GitHub Issues (HTTP ${response.status}).`,
      );
    }
    return response.json();
  }

  async function listPages(path) {
    const endpoint = new URL(path, repoApi);
    endpoint.searchParams.set('per_page', String(pageSize));
    const entries = [];
    for (let page = 1; ; page++) {
      endpoint.searchParams.set('page', String(page));
      const batch = await send(endpoint.href);
      if (!Array.isArray(batch))
        throw new Error('GitHub returned an invalid issue or comment list.');
      entries.push(...batch);
      if (batch.length < pageSize) return entries;
    }
  }

  async function listIssues() {
    const issues = await listPages('issues?state=all');
    return issues.filter((issue) => !issue.pull_request && issue.number !== Number(trackingIssue));
  }

  async function publishNoFindings(decision, report, runUrl) {
    if (!/^[1-9][0-9]*$/.test(trackingIssue ?? '')) {
      throw new Error('The audit tracking issue number is invalid.');
    }
    const path = `issues/${trackingIssue}`;
    const tracker = await send(path);
    if (tracker.number !== Number(trackingIssue) || tracker.pull_request) {
      throw new Error('The audit tracking entry must be a repository issue.');
    }
    const expected = marker(report, 'no-findings');
    const comments = await listPages(`${path}/comments`);
    const previous = comments.find((comment) => carriesMarker(comment, expected));
    const comment =
      previous ??
      (await send(`${path}/comments`, {
        body: [
          expected,
          '',
          '## Lighthouse-аудит без находок по порогу',
          '',
          `Сервис «Запись на звонок», [главная страница](<${report.appUrl}>), мобильный профиль.`,
          markdownText(decision.summary),
          '',
          `[Прогон и исходный отчёт Lighthouse](${runUrl})`,
        ].join('\n'),
      }));
    if (!Number.isSafeInteger(comment.id) || comment.id < 1) {
      throw new Error('GitHub did not return the audit comment ID.');
    }
    return {
      action: previous ? 'existing-comment' : 'comment-posted',
      url: `${repoUrl}/${path}#issuecomment-${comment.id}`,
    };
  }

  async function publish(decision, report) {
    if (!serverUrl || !/^[1-9][0-9]*$/.test(runId ?? '')) {
      throw new Error('The GitHub Actions run URL is unavailable.');
    }
    const runUrl = `${repoUrl}/actions/runs/${runId}`;
    if (decision.status === 'no-findings') return publishNoFindings(decision, report, runUrl);

    if (decision.status === 'duplicate') {
      return { action: 'existing-issue', url: `${repoUrl}/issues/${decision.issueNumber}` };
    }
    const existing = findRecordedIssue(await listIssues(), report, decision.auditId);
    if (existing) {
      return { action: 'existing-issue', url: `${repoUrl}/issues/${existing.number}` };
    }
    const issue = await send('issues', findingIssue(decision, report, runUrl));
    if (!Number.isSafeInteger(issue.number) || issue.number < 1) {
      throw new Error('GitHub did not return the new issue number.');
    }
    return { action: 'issue-created', url: `${repoUrl}/issues/${issue.number}` };
  }

  return { listIssues, publish };
}
