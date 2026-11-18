import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { summarizeLighthouseReports } from './lighthouse-report.mjs';

const appUrl = 'https://calendar.example/';
const target = { appUrl, mode: 'live' };
const renderBlocking = 'render-blocking-insight';
const documentLatency = 'document-latency-insight';

function report(audits) {
  return {
    requestedUrl: appUrl,
    mainDocumentUrl: appUrl,
    lighthouseVersion: '13.6.0',
    configSettings: { formFactor: 'mobile' },
    categories: { performance: { score: 0.9 } },
    audits,
  };
}

function insight(metricSavings, score = 0) {
  return { title: 'Render-blocking requests', score, metricSavings };
}

test('uses two of three failed measurements and orders findings by median savings', () => {
  const result = summarizeLighthouseReports(
    [
      report({
        [renderBlocking]: insight({ FCP: 300, LCP: 100 }),
        [documentLatency]: insight({ FCP: 500 }),
      }),
      report({
        [renderBlocking]: {
          ...insight({ LCP: 440 }),
          details: {
            items: [
              { url: 'https://calendar.example/theme.css?cache=1#anchor' },
              { url: 'https://calendar.example/theme.css?cache=2' },
              { url: 'data:text/plain,ignored' },
            ],
          },
        },
        [documentLatency]: insight({ FCP: 800 }),
      }),
      report({
        [renderBlocking]: insight({ FCP: 810 }, 1),
        [documentLatency]: insight({ FCP: 299 }),
      }),
    ],
    target,
  );
  assert.deepEqual(result.performanceScores, [0.9, 0.9, 0.9]);
  assert.deepEqual(
    result.findings.map(({ auditId, medianSavingsMs }) => [auditId, medianSavingsMs]),
    [
      [documentLatency, 500],
      [renderBlocking, 300],
    ],
  );
  assert.deepEqual(result.findings[1].samples, [
    { fcpMs: 300, lcpMs: 100 },
    { fcpMs: 0, lcpMs: 440 },
    { fcpMs: 0, lcpMs: 0 },
  ]);
  assert.deepEqual(result.findings[1].resources, ['https://calendar.example/theme.css']);
});

test('one slow sample and failures outside the insight rule yield an empty shortlist', () => {
  const result = summarizeLighthouseReports(
    [500, 299, 20].map((fcpMs) =>
      report({
        [renderBlocking]: insight({ FCP: fcpMs }),
        'unused-javascript': insight({ FCP: 800 }),
      }),
    ),
    target,
  );
  assert.equal(result.status, 'collected');
  assert.deepEqual(result.findings, []);
});

test('rejects missing, failed and misdirected runs', () => {
  const good = report({ [renderBlocking]: insight({ FCP: 20 }) });
  assert.throws(() => summarizeLighthouseReports([good, good], target), /Expected 3/);
  for (const invalid of [
    { ...good, runtimeError: { code: 'ERRORED_DOCUMENT_REQUEST' } },
    { ...good, mainDocumentUrl: 'https://other.example/' },
    { ...good, configSettings: { formFactor: 'desktop' } },
    { ...good, categories: { performance: { score: null } } },
    { ...good, audits: ['missing audit data'] },
  ]) {
    assert.throws(
      () => summarizeLighthouseReports([good, invalid, good], target),
      /report 2 is incomplete or is for another target/,
    );
  }
});

test('the collection entry point generates reproducible and labelled training data', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lighthouse-report-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('./lighthouse-report.mjs', import.meta.url));
  const reportsByRun = [];
  for (const run of ['first', 'second']) {
    const runnerTemp = join(directory, run);
    await mkdir(runnerTemp);
    execFileSync(process.execPath, [script], {
      env: { ...process.env, RUNNER_TEMP: runnerTemp, APP_URL: appUrl, AUDIT_MODE: 'demo' },
    });
    const reportDirectory = join(runnerTemp, 'lighthouse-audit', 'report');
    const summary = JSON.parse(await readFile(join(reportDirectory, 'summary.json'), 'utf8'));
    const rawDirectory = join(reportDirectory, 'raw');
    const filenames = (await readdir(rawDirectory)).sort();
    assert.deepEqual(filenames, ['demo-1.json', 'demo-2.json', 'demo-3.json']);
    const rawReports = await Promise.all(
      filenames.map(async (filename) =>
        JSON.parse(await readFile(join(rawDirectory, filename), 'utf8')),
      ),
    );
    assert.ok(rawReports.every((rawReport) => rawReport.synthetic === true));
    assert.equal(summary.mode, 'demo');
    assert.deepEqual(
      summary.findings.map(({ auditId }) => auditId),
      [renderBlocking],
    );
    reportsByRun.push({ rawReports, summary });
  }
  assert.deepEqual(reportsByRun[0], reportsByRun[1]);
});
