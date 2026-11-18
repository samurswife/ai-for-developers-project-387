import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const sampleCount = 3;
const minimumSavingsMs = 300;
const auditIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*-insight$/;

export function summarizeLighthouseReports(reports, { appUrl, mode }) {
  if (reports.length !== sampleCount) {
    throw new Error(`Expected ${sampleCount} Lighthouse reports, got ${reports.length}.`);
  }
  const performanceScores = reports.map((report, index) => {
    const score = report?.categories?.performance?.score;
    if (
      report?.runtimeError ||
      report?.requestedUrl !== appUrl ||
      report.mainDocumentUrl !== appUrl ||
      report.configSettings?.formFactor !== 'mobile' ||
      typeof report.lighthouseVersion !== 'string' ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 1 ||
      !report.audits ||
      typeof report.audits !== 'object' ||
      Array.isArray(report.audits) ||
      Object.keys(report.audits).length === 0
    ) {
      throw new Error(`Lighthouse report ${index + 1} is incomplete or is for another target.`);
    }
    return score;
  });

  const findings = [];
  const auditIds = new Set(reports.flatMap((report) => Object.keys(report.audits)));
  for (const auditId of auditIds) {
    if (!auditIdPattern.test(auditId)) continue;
    const audits = reports.map((report) => report.audits[auditId]);
    const samples = audits.map(savingsForRun);
    const estimates = samples.map(({ fcpMs, lcpMs }) => Math.max(fcpMs, lcpMs));
    const medianSavingsMs = estimates.toSorted((a, b) => a - b)[1];
    if (medianSavingsMs < minimumSavingsMs) continue;
    const evidence = audits[estimates.indexOf(Math.max(...estimates))];
    findings.push({
      auditId,
      title: typeof evidence.title === 'string' ? evidence.title.slice(0, 160) : auditId,
      samples,
      medianSavingsMs,
      resources: resourceUrls(evidence.details?.items),
    });
  }

  findings.sort(
    (a, b) => b.medianSavingsMs - a.medianSavingsMs || a.auditId.localeCompare(b.auditId),
  );
  return {
    status: 'collected',
    mode,
    appUrl,
    profile: 'mobile',
    lighthouseVersion: reports[0].lighthouseVersion,
    performanceScores,
    findings,
  };
}

function savingsForRun(audit) {
  if (audit?.score !== 0) return { fcpMs: 0, lcpMs: 0 };
  const { FCP, LCP } = audit.metricSavings ?? {};
  return {
    fcpMs: Number.isFinite(FCP) ? Math.max(0, FCP) : 0,
    lcpMs: Number.isFinite(LCP) ? Math.max(0, LCP) : 0,
  };
}

function resourceUrls(items) {
  if (!Array.isArray(items)) return [];
  const resources = new Set();
  for (const item of items) {
    if (typeof item?.url !== 'string' || !URL.canParse(item.url)) continue;
    const url = new URL(item.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    resources.add(`${url.origin}${url.pathname}`.slice(0, 300));
    if (resources.size === 3) break;
  }
  return [...resources];
}

async function verifyPage(appUrl) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(appUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    }).catch(() => undefined);
    await response?.body?.cancel();
    if (response?.ok) return;
    if (attempt < 3) await setTimeout(2_000);
  }
  throw new Error(
    'The audit target did not return a successful HTTP response after three attempts.',
  );
}

async function collectLive(workDirectory, rawDirectory, appUrl) {
  await verifyPage(appUrl);
  const lighthouseDirectory = join(workDirectory, '.lighthouseci');
  await mkdir(lighthouseDirectory);
  try {
    execFileSync(
      'npm',
      [
        'exec',
        '--yes',
        '--package=@lhci/cli@0.16.0',
        '--',
        'lhci',
        'collect',
        `--numberOfRuns=${sampleCount}`,
        '--settings.onlyCategories=performance',
        `--url=${appUrl}`,
      ],
      { cwd: workDirectory, stdio: 'inherit' },
    );
  } finally {
    await rename(lighthouseDirectory, rawDirectory);
  }
}

async function createDemo(rawDirectory, appUrl) {
  await mkdir(rawDirectory);
  for (let index = 1; index <= sampleCount; index++) {
    const auditId = 'render-blocking-insight';
    const report = {
      synthetic: true,
      note: 'Training data. The application was not measured.',
      requestedUrl: appUrl,
      mainDocumentUrl: appUrl,
      lighthouseVersion: 'synthetic',
      configSettings: { formFactor: 'mobile' },
      categories: { performance: { score: 0.72 } },
      audits: {
        [auditId]: {
          id: auditId,
          title: 'Synthetic render-blocking stylesheet',
          score: 0,
          metricSavings: { FCP: 420 },
          details: { items: [{ url: 'https://example.invalid/demo.css' }] },
        },
      },
    };
    await writeFile(
      join(rawDirectory, `demo-${index}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
}

async function run() {
  const { AUDIT_MODE: mode, APP_URL, RUNNER_TEMP } = process.env;
  if (!RUNNER_TEMP) throw new Error('Set RUNNER_TEMP to an existing temporary directory.');
  const workDirectory = join(RUNNER_TEMP, 'lighthouse-audit');
  const artifactDirectory = join(workDirectory, 'report');
  const rawDirectory = join(artifactDirectory, 'raw');
  const summaryPath = join(artifactDirectory, 'summary.json');
  await mkdir(workDirectory);
  await mkdir(artifactDirectory);

  try {
    if (mode !== 'live' && mode !== 'demo') throw new Error('Set AUDIT_MODE to live or demo.');
    const target = URL.parse(APP_URL ?? '');
    if (
      !target ||
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    ) {
      throw new Error('Set APP_URL to an HTTPS page URL without credentials, query or fragment.');
    }

    if (mode === 'live') await collectLive(workDirectory, rawDirectory, target.href);
    else await createDemo(rawDirectory, target.href);

    const files = await readdir(rawDirectory);
    const jsonFiles = files.filter((filename) => filename.endsWith('.json')).sort();
    if (
      mode === 'live' &&
      jsonFiles.some((filename) => !files.includes(filename.replace(/\.json$/, '.html')))
    ) {
      throw new Error('At least one Lighthouse HTML report is missing.');
    }
    const reports = await Promise.all(
      jsonFiles.map(async (filename) =>
        JSON.parse(await readFile(join(rawDirectory, filename), 'utf8')),
      ),
    );
    const summary = summarizeLighthouseReports(reports, { appUrl: target.href, mode });
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(
      `Lighthouse ${mode}: ${reports.length} reports, ${summary.findings.length} audit candidates.`,
    );
  } catch (error) {
    await writeFile(summaryPath, `${JSON.stringify({ status: 'no-data', mode }, null, 2)}\n`);
    throw error;
  }
}

if (import.meta.main) await run();
