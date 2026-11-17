import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateResults, verifyHead } from '../smoke-tests/evidence.mjs';

const head = 'a'.repeat(40);
const report = () => ({
  success: true,
  numTotalTests: 1,
  numPassedTests: 1,
  testResults: [
    {
      name: '/tests/booking.smoke.test.ts',
      assertionResults: [{ fullName: ' books a slot ', status: 'passed' }],
    },
  ],
});
const evidence = () => [
  {
    title: 'books a slot',
    file: '/tests/booking.smoke.test.ts',
    complete: true,
    trace: 'scenarios/one/trace.zip',
    screenshots: ['scenarios/one/page-0.png'],
  },
];

test('head verification refuses the merge SHA and invalid/missing actual SHA', () => {
  assert.doesNotThrow(() => verifyHead(head, head));
  assert.doesNotThrow(() => verifyHead(head));
  for (const actual of ['b'.repeat(40), '', 'HEAD', 'a'.repeat(39)]) {
    assert.throws(() => verifyHead(actual, head), /SHA mismatch/);
  }
});

test('successful results require a trace and screenshot for each exact scenario and file', () => {
  assert.equal(validateResults(report(), evidence()).length, 1);
  for (const scenarios of [
    [],
    [{ ...evidence()[0], complete: false }],
    [{ ...evidence()[0], trace: '' }],
    [{ ...evidence()[0], screenshots: [] }],
    [{ ...evidence()[0], file: '/other.spec.ts' }],
    [{ ...evidence()[0], title: 'unrelated test' }],
  ]) {
    assert.throws(() => validateResults(report(), scenarios), /Missing browser trace/);
  }
});

test('empty, failed, skipped and incomplete reports never become successful evidence', () => {
  for (const value of [
    undefined,
    { ...report(), success: false },
    { ...report(), numTotalTests: 0 },
    { ...report(), numPassedTests: 0 },
    { ...report(), testResults: [] },
    {
      ...report(),
      testResults: [
        {
          name: '/tests/booking.smoke.test.ts',
          assertionResults: [{ fullName: 'books a slot', status: 'pending' }],
        },
      ],
    },
  ]) {
    assert.throws(() => validateResults(value, evidence()));
  }
});

test('another passing scenario cannot hide a missing result or evidence', () => {
  const value = report();
  value.numTotalTests = value.numPassedTests = 2;
  value.testResults[0].assertionResults.push({ fullName: 'neighbouring date', status: 'passed' });
  assert.throws(() => validateResults(value, evidence()), /neighbouring date/);
});

test('actual CI finalizer refuses a zero-exit command with absent, stale, dirty or failed evidence', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/check.yml', import.meta.url),
    'utf8',
  );
  const script = workflow
    .split("python3 - <<'PY'\n")[1]
    .split('          PY')[0]
    .split('\n')
    .map((line) => line.slice(10))
    .join('\n');
  for (const overrides of [
    null,
    {},
    { sha: 'b'.repeat(40) },
    { dirty: true },
    { status: 'failed' },
  ]) {
    const temporary = mkdtempSync(join(tmpdir(), 'browser-ci-'));
    const directory = join(temporary, 'browser-head');
    mkdirSync(directory);
    try {
      if (overrides !== null)
        writeFileSync(
          join(directory, 'result.json'),
          JSON.stringify({
            sha: head,
            expected_sha: head,
            dirty: false,
            status: 'passed',
            ...overrides,
          }),
        );
      const result = spawnSync('python3', ['-'], {
        input: script,
        encoding: 'utf8',
        env: {
          ...process.env,
          RUNNER_TEMP: temporary,
          EXPECTED_HEAD_SHA: head,
          CHECKOUT_OUTCOME: 'success',
          TOOLS_OUTCOME: 'success',
          SETUP_OUTCOME: 'success',
          BROWSER_OUTCOME: 'success',
        },
      });
      assert.equal(
        result.status,
        overrides && Object.keys(overrides).length === 0 ? 0 : 1,
        result.stderr,
      );
      assert.equal(
        JSON.parse(readFileSync(join(directory, 'job.json'), 'utf8')).EXPECTED_HEAD_SHA,
        head,
      );
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
});
