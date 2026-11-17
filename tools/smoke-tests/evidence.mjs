import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, readdir, writeFile, appendFile, stat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyHead(actual, expected) {
  if (!/^[a-f0-9]{40}$/.test(actual) || (expected && actual !== expected)) {
    throw new Error(`Head SHA mismatch: expected ${expected}, checked out ${actual}`);
  }
}

export function validateResults(report, scenarios) {
  if (
    !report?.success ||
    report.numTotalTests < 1 ||
    report.numPassedTests !== report.numTotalTests
  ) {
    throw new Error('Browser tests failed, were skipped or produced no result');
  }
  const tests = report.testResults.flatMap((file) =>
    file.assertionResults.map((test) => ({
      name: test.fullName.trim(),
      file: file.name,
      status: test.status,
    })),
  );
  if (tests.length !== report.numTotalTests || tests.some((test) => test.status !== 'passed')) {
    throw new Error('Incomplete browser test report');
  }
  for (const test of tests) {
    if (
      !scenarios.some(
        (scenario) =>
          scenario.complete &&
          scenario.title === test.name &&
          scenario.file === test.file &&
          scenario.trace &&
          scenario.screenshots.length > 0,
      )
    ) {
      throw new Error(`Missing browser trace/screenshot for ${test.name}`);
    }
  }
  return tests;
}

async function run() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const directory = resolve(
    process.env.BROWSER_ARTIFACT_DIR || join(root, '.cache/browser-evidence'),
  );
  await mkdir(directory, { recursive: true });
  // An old successful report must never be reused in another invocation.
  const entries = await readdir(directory);
  if (entries.some((entry) => entry !== 'checkout-sha.txt'))
    throw new Error('Evidence directory must be empty');
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const expected = process.env.EXPECTED_HEAD_SHA;
  const metadata = {
    sha: actual,
    expected_sha: expected ?? null,
    pr: process.env.PR_NUMBER ?? null,
    run_id: process.env.GITHUB_RUN_ID ?? null,
    run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    started_at: new Date().toISOString(),
    status: 'running',
    command: 'vitest run',
  };
  const save = async () =>
    writeFile(join(directory, 'result.json'), JSON.stringify(metadata, null, 2));
  await save();
  await writeFile(join(directory, 'head-sha.txt'), `${actual}\n`);
  let exitCode = 1;
  try {
    verifyHead(actual, expected);
    metadata.dirty =
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '';
    if (process.env.CI && metadata.dirty) throw new Error('CI checkout contains uncommitted files');
    const args = [
      '--filter',
      '@calendar/smoke-tests',
      'exec',
      'vitest',
      'run',
      ...process.argv.slice(2),
    ];
    metadata.command = `pnpm ${args.join(' ')}`;
    const child = spawn('pnpm', args, {
      cwd: root,
      env: { ...process.env, BROWSER_ARTIFACT_DIR: directory },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const writes = [];
    const collect = (target) => (chunk) => {
      target.write(chunk);
      writes.push(appendFile(join(directory, 'browser.log'), chunk));
    };
    child.stdout.on('data', collect(process.stdout));
    child.stderr.on('data', collect(process.stderr));
    const [code] = await once(child, 'close');
    exitCode = code ?? 1;
    await Promise.all(writes);
    const report = JSON.parse(await readFile(join(directory, 'test-results.json'), 'utf8'));
    metadata.tests = {
      total: report.numTotalTests,
      passed: report.numPassedTests,
      failed: report.numFailedTests,
    };
    const scenarios = [];
    for (const name of await readdir(join(directory, 'scenarios'))) {
      const folder = join(directory, 'scenarios', name);
      const scenario = JSON.parse(await readFile(join(folder, 'scenario.json'), 'utf8'));
      if ((await stat(join(folder, scenario.trace))).size === 0) throw new Error('Empty trace');
      for (const screenshot of scenario.screenshots) {
        if ((await stat(join(folder, screenshot))).size === 0) throw new Error('Empty screenshot');
      }
      scenarios.push({
        ...scenario,
        trace: relative(directory, join(folder, scenario.trace)),
        screenshots: scenario.screenshots.map((imageName) =>
          relative(directory, join(folder, imageName)),
        ),
      });
    }
    metadata.scenarios = scenarios;
    if (exitCode !== 0) throw new Error(`Browser process exited ${exitCode}`);
    verifyHead(
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      actual,
    );
    validateResults(report, scenarios);
    metadata.status = 'passed';
  } catch (error) {
    metadata.status = 'failed';
    metadata.error = error.message;
    console.error(error);
    exitCode = 1;
  } finally {
    metadata.finished_at = new Date().toISOString();
    await save();
    const summary = [
      `# Browser head verification`,
      '',
      `SHA: ${actual}`,
      `Result: ${metadata.status}`,
      `PR: ${metadata.pr ?? 'local'}; run: ${metadata.run_id ?? 'local'}; attempt: ${metadata.run_attempt ?? 'local'}`,
      '',
      metadata.error ?? '',
      'Results and assertions: test-results.json; browser actions: scenarios/*/trace.zip.',
      ...(metadata.scenarios ?? []).map((scenario) => `- ${scenario.title}: ${scenario.trace}`),
    ].join('\n');
    await writeFile(join(directory, 'summary.md'), summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  process.exitCode = metadata.status === 'passed' ? 0 : exitCode || 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
