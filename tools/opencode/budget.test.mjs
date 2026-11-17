import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../../.github/workflows/opencode.yml', import.meta.url),
  'utf8',
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function source(id, text = workflow) {
  const step = text
    .split(`        id: ${id}\n`)[1]
    ?.split(/(?=^      - name:|^      #|^  [\w-]+:)/m)[0];
  assert.ok(step, `Missing step ${id}`);
  return step
    .split('          script: |\n')[1]
    .trimEnd()
    .split('\n')
    .map((line) => line.slice(12))
    .join('\n');
}

const run = (id, overrides = {}) => ({
  id,
  workflow_id: 7,
  run_attempt: 1,
  event: 'issue_comment',
  display_title: 'OpenCode PR #42',
  path: '.github/workflows/opencode.yml',
  ...overrides,
});
const job = (attempt = 1, overrides = {}) => ({
  name: 'opencode',
  run_attempt: attempt,
  status: 'completed',
  conclusion: 'success',
  steps: [
    {
      name: 'Reserve PR attempt',
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-11-17T00:00:00Z',
    },
  ],
  ...overrides,
});

async function gate(options = {}) {
  const outputs = new Map();
  const errors = [];
  const calls = [];
  const current = options.current ?? run(100, { run_attempt: options.attempt ?? 1 });
  const history = options.history ?? [current];
  const env = {
    GITHUB_RUN_ID: '100',
    GITHUB_RUN_ATTEMPT: String(options.attempt ?? 1),
    REQUEST_KIND: 'PR',
    REQUEST_NUMBER: '42',
    ...options.env,
  };
  const github = {
    rest: {
      apps: {
        getBySlug: async () => ({
          data: { permissions: options.appPermissions ?? { actions: 'read' } },
        }),
      },
      actions: {
        getWorkflowRun: async () => ({ data: current }),
        listWorkflowRuns: async ({ page }) => {
          if (options.historyError) throw new Error('History unavailable');
          return {
            data: {
              workflow_runs: history.slice((page - 1) * 100, page * 100),
              total_count: options.total ?? history.length,
            },
          };
        },
        listJobsForWorkflowRunAttempt: async (input) => {
          calls.push(input);
          if (options.jobsError) throw new Error('Jobs unavailable');
          return {
            data: {
              jobs: options.jobs?.[`${input.run_id}:${input.attempt_number}`] ?? [
                job(input.attempt_number),
              ],
            },
          };
        },
      },
    },
    paginate: async (method, input) => (await method(input)).data.jobs,
  };
  await new AsyncFunction('github', 'context', 'core', 'process', source('budget'))(
    github,
    { repo: { owner: 'example', repo: 'calendar' } },
    {
      setOutput: (key, value) => outputs.set(key, String(value)),
      setFailed: (message) => errors.push(message),
      notice() {},
    },
    { env },
  );
  return { outputs, errors, calls };
}

test('fourth PR command is refused before any model call; a fresh PR gets three attempts', async () => {
  for (let previous = 0; previous <= 3; previous += 1) {
    const { outputs, errors } = await gate({
      history: [run(100), ...Array.from({ length: previous }, (_, i) => run(i + 1))],
    });
    assert.deepEqual(errors, []);
    assert.equal(outputs.get('allowed'), previous < 3 ? 'true' : 'false');
    assert.equal(outputs.get('reason'), previous < 3 ? 'admitted' : 'limit_exhausted');
    assert.equal(outputs.get('used'), String(Math.min(3, previous + 1)));
  }
  assert.equal(
    (await gate({ history: [run(100), run(1, { display_title: 'OpenCode PR #43' })] })).outputs.get(
      'used',
    ),
    '1',
  );
});

test('general and inline comments share a budget; issues and autoreview do not consume it', async () => {
  const { outputs } = await gate({
    history: [
      run(100),
      run(1),
      run(2, { event: 'pull_request_review_comment' }),
      run(3, { display_title: 'OpenCode issue #42' }),
      run(4, { event: 'pull_request', workflow_id: 8 }),
    ],
  });
  assert.equal(outputs.get('used'), '3');
  assert.equal(outputs.get('allowed'), 'true');
  const issue = await gate({ env: { REQUEST_KIND: 'issue' } });
  assert.equal(issue.outputs.get('allowed'), 'true');
  assert.equal(issue.calls.length, 0);
});

test('Re-run counts each executed job attempt, including cancellations and timeouts', async () => {
  const { outputs, calls } = await gate({
    attempt: 4,
    jobs: {
      '100:1': [job(1, { conclusion: 'cancelled' })],
      '100:2': [job(2, { conclusion: 'timed_out' })],
      '100:3': [job(3, { conclusion: 'failure' })],
    },
  });
  assert.equal(outputs.get('reason'), 'limit_exhausted');
  assert.deepEqual(
    calls.map((entry) => entry.attempt_number),
    [1, 2, 3],
  );
});

test('rerunning only the executing job rechecks budget; rerunning only a reporter spends nothing', async () => {
  const result = await gate({
    attempt: 3,
    jobs: { '100:2': [{ name: 'authorize', run_attempt: 2, steps: [] }] },
  });
  assert.equal(result.outputs.get('used'), '2');
  assert.equal(result.outputs.get('allowed'), 'true');
});

test('skipped jobs, queued requests and rejected authorization do not consume an attempt', async () => {
  const result = await gate({
    history: [run(100), run(1), run(2), run(3)],
    jobs: {
      '1:1': [job(1, { conclusion: 'skipped', steps: [] })],
      '2:1': [job(1, { status: 'queued', steps: [] })],
      '3:1': [
        job(1, {
          steps: [
            {
              name: 'Reserve PR attempt',
              status: 'completed',
              conclusion: 'skipped',
              started_at: null,
            },
          ],
        }),
      ],
    },
  });
  assert.equal(result.outputs.get('used'), '1');
});

test('history is paginated and comments cannot reset the counter', async () => {
  const history = Array.from({ length: 100 }, (_, i) =>
    run(i + 100, { display_title: 'OpenCode issue #1' }),
  );
  history[0] = run(100);
  history.push(run(1), run(2), run(3));
  assert.equal((await gate({ history })).outputs.get('reason'), 'limit_exhausted');
});

test('unavailable or incomplete Actions history fails closed', async () => {
  for (const options of [
    { historyError: true },
    { history: [run(100), run(1)], jobsError: true },
    { total: 101 },
    { history: [] },
    { appPermissions: { actions: 'write' } },
    { appPermissions: { actions: 'read', workflows: 'write' } },
  ]) {
    const { outputs, errors } = await gate(options);
    assert.equal(outputs.get('allowed'), 'false');
    assert.equal(outputs.get('reason'), 'infra');
    assert.equal(errors.length, 1);
  }
});

test('old run titles, another workflow and invalid current-run identity cannot grant extra calls', async () => {
  const old = await gate({ history: [run(100), run(1, { display_title: 'Old title' })] });
  assert.equal(old.outputs.get('used'), '1');
  for (const current of [
    run(100, { display_title: 'OpenCode PR #43' }),
    run(100, { path: '.github/workflows/other.yml' }),
    run(100, { run_attempt: 2 }),
  ]) {
    const { outputs, errors } = await gate({ current });
    assert.equal(outputs.get('allowed'), 'false');
    assert.equal(errors.length, 1);
  }
});

test('budget reservation precedes checkout, installation, key and CLI in the executing job', () => {
  const execution = workflow.split('\n  opencode:\n')[1];
  assert.ok(execution.indexOf('id: budget') < execution.indexOf('actions/checkout@'));
  assert.match(execution, /name: Run OpenCode\n\s+if: steps\.budget\.outputs\.allowed == 'true'/);
  assert.match(execution, /timeout --signal=TERM --kill-after=20s 45m opencode github run/);
  assert.match(execution, /actions: read/);
  assert.doesNotMatch(execution, /actions: write|pull-requests: write|issues: write/);
});

test('both authorization checks revalidate the rerun initiator, PR state and repository', async () => {
  for (const id of ['authorize', 'request']) {
    for (const scenario of [
      'allowed',
      'fork',
      'closed',
      'base',
      'bot',
      'substring',
      'revoked',
      'rerun',
    ]) {
      const outputs = new Map();
      const payload = {
        repository: { full_name: 'example/calendar', default_branch: 'main' },
        issue: { number: 42, pull_request: {} },
        comment: {
          body: '/oc fix',
          author_association: 'OWNER',
          user: { login: 'owner', type: 'User' },
        },
      };
      if (scenario === 'bot') payload.comment.user.type = 'Bot';
      if (scenario === 'substring') payload.comment.body = 'text /occupy';
      const pr = {
        state: scenario === 'closed' ? 'closed' : 'open',
        head: { repo: { full_name: scenario === 'fork' ? 'other/calendar' : 'example/calendar' } },
        base: {
          ref: scenario === 'base' ? 'other' : 'main',
          repo: { full_name: 'example/calendar' },
        },
      };
      const github = {
        rest: {
          repos: {
            getCollaboratorPermissionLevel: async ({ username }) => ({
              data: {
                permission: scenario === 'revoked' || username === 'outsider' ? 'read' : 'write',
              },
            }),
          },
          pulls: { get: async () => ({ data: pr }) },
        },
      };
      await new AsyncFunction('github', 'context', 'core', 'process', source(id))(
        github,
        { payload, actor: 'owner', repo: {} },
        { setOutput: (key, value) => outputs.set(key, value), notice() {} },
        { env: { GITHUB_TRIGGERING_ACTOR: scenario === 'rerun' ? 'outsider' : 'owner' } },
      );
      assert.equal(
        outputs.get('allowed'),
        scenario === 'allowed' ? 'true' : 'false',
        `${id}: ${scenario}`,
      );
    }
  }
});

const reporter = readFileSync(
  new URL('../../.github/workflows/opencode-result.yml', import.meta.url),
  'utf8',
);
const reporterPermissions = Object.fromEntries(
  reporter
    .split('    permissions:\n')[1]
    .split('    steps:')[0]
    .trim()
    .split('\n')
    .map((line) => line.trim().split(': ')),
);
async function report(options = {}) {
  const comments = [];
  const steps = (
    options.steps ?? ['Revalidate request', 'Reserve PR attempt', 'Budget exhausted']
  ).map((name) => ({
    name,
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-11-17T00:00:00Z',
  }));
  const current = run(100, {
    status: 'completed',
    head_sha: 'default-branch-sha',
    head_repository: { full_name: 'example/calendar' },
    ...options.run,
  });
  const github = {
    rest: {
      actions: {
        getWorkflow: async () => ({ data: { id: 7 } }),
        getWorkflowRunAttempt: async () => ({ data: current }),
        listJobsForWorkflowRunAttempt: async () => ({
          data: {
            jobs: options.jobs ?? [
              job(current.run_attempt, { steps, conclusion: options.conclusion ?? 'failure' }),
            ],
          },
        }),
      },
      pulls: {
        get: async () => ({
          data: {
            head: {
              sha: 'latest-pr-head',
              repo: { full_name: options.fork ? 'outsider/calendar' : 'example/calendar' },
            },
            base: { repo: { full_name: 'example/calendar' } },
          },
        }),
      },
      issues: {
        listComments: async () => ({ data: options.comments ?? [] }),
        createComment: async (input) => {
          const permissions = options.permissions ?? reporterPermissions;
          // Mirror the 403 observed on PR #21 with issues:write + pull-requests:read.
          const resource = current.display_title.startsWith('OpenCode PR #')
            ? 'pull-requests'
            : 'issues';
          if (permissions[resource] !== 'write') {
            throw Object.assign(new Error('Resource not accessible by integration'), {
              status: 403,
            });
          }
          comments.push(input);
        },
      },
    },
    paginate: async (method, input) => {
      const { data } = await method(input);
      return data.jobs ?? data;
    },
  };
  await new AsyncFunction('github', 'context', 'core', source('report', reporter))(
    github,
    {
      repo: { owner: 'example', repo: 'calendar' },
      payload: {
        repository: { full_name: 'example/calendar' },
        workflow_run: { id: 100, run_attempt: options.attempt ?? 1 },
      },
    },
    { summary: { addRaw: () => ({ write: async () => {} }) } },
  );
  return comments;
}

test('publication respects configured PR and issue permissions, reproducing the observed 403', async () => {
  await assert.rejects(report({ permissions: { issues: 'write', 'pull-requests': 'read' } }), {
    status: 403,
  });
  assert.equal((await report()).length, 1);
  assert.equal((await report({ run: { display_title: 'OpenCode issue #42' } })).length, 1);
  await assert.rejects(
    report({
      run: { display_title: 'OpenCode issue #42' },
      permissions: { issues: 'read', 'pull-requests': 'write' },
    }),
    { status: 403 },
  );
});

test('model-free exhaustion report includes reason, latest PR SHA, exact attempt logs and human status', async () => {
  const [comment] = await report();
  assert.equal(comment.issue_number, 42);
  assert.match(comment.body, /limit_exhausted/);
  assert.match(comment.body, /latest-pr-head/);
  assert.doesNotMatch(comment.body, /default-branch-sha/);
  assert.match(comment.body, /actions\/runs\/100\/attempts\/1/);
  assert.match(comment.body, /нужен человек/);
});

test('completion reporter distinguishes timeout, preparation, auth, agent failure and cancellation', async () => {
  for (const [last, conclusion, expected] of [
    ['Agent timeout', 'failure', 'timeout'],
    ['Infrastructure failure', 'failure', 'infra'],
    ['Agent failed', 'failure', 'agent_failed'],
    ['Run OpenCode', 'success', 'success'],
    ['Install OpenCode v1.19.4', 'failure', 'infra'],
    ['Install mise and tools', 'failure', 'infra'],
    ['Install dependencies and Chromium', 'failure', 'infra'],
    ['Verify unattended permissions', 'failure', 'infra'],
    ['Reserve PR attempt', 'cancelled', 'agent_failed'],
    ['Run OpenCode', 'timed_out', 'timeout'],
  ]) {
    const [comment] = await report({
      steps: ['Revalidate request', 'Reserve PR attempt', last],
      conclusion,
    });
    assert.ok(comment.body.includes(`Причина: \`${expected}\``), last);
  }
});

test('reporter ignores foreign workflows/repos, stale attempt payloads and unauthorised or queued requests', async () => {
  for (const options of [
    { run: { workflow_id: 8 } },
    { run: { path: 'other.yml' } },
    { run: { display_title: 'untrusted #42' } },
    { run: { head_repository: { full_name: 'outsider/calendar' } } },
    { run: { run_attempt: 2 } },
    { run: { event: 'pull_request' } },
    { fork: true },
    { jobs: [] },
    { steps: [] },
    { steps: ['Revalidate request'], conclusion: 'success' },
  ])
    assert.deepEqual(await report(options), [], JSON.stringify(options));
});

test('only an existing bot result for the same attempt deduplicates reporting', async () => {
  const marker = '<!-- opencode-result:100:1 -->';
  assert.equal(
    (await report({ comments: [{ user: { login: 'owner' }, body: marker }] })).length,
    1,
  );
  assert.equal(
    (await report({ comments: [{ user: { login: 'github-actions[bot]' }, body: marker }] })).length,
    0,
  );
  assert.equal(
    (
      await report({
        comments: [
          { user: { login: 'github-actions[bot]' }, body: '<!-- opencode-result:100:2 -->' },
        ],
      })
    ).length,
    1,
  );
});

test('reporter has no model, checkout, artifacts, credentials or source-run code execution', () => {
  assert.match(reporter, /workflow_run:[\s\S]*workflows: \[OpenCode\]/);
  assert.doesNotMatch(
    reporter,
    /actions\/checkout|download-artifact|secrets\.|id-token: write|child_process|execSync|spawn\(|eval\(|require\(/,
  );
  assert.match(reporter, /issues: write/);
  assert.match(reporter, /pull-requests: write/);
  assert.doesNotMatch(reporter, /contents: write|actions: write/);
});

test('actual CLI result classifier distinguishes failure reasons and redacts key and bearer credentials', () => {
  const script = workflow
    .split("python3 - <<'PYTHON'\n")[1]
    .split('          PYTHON')[0]
    .split('\n')
    .map((line) => line.slice(10))
    .join('\n');
  const directory = mkdtempSync(path.join(tmpdir(), 'opencode-budget-'));
  try {
    for (const [code, log, expected] of [
      [0, 'Discuss billing and authentication in the documentation', 'success'],
      [1, 'Unauthorized: test-redaction-value; Bearer private-bearer-value', 'infra'],
      [124, 'stopped', 'timeout'],
      [137, 'killed', 'timeout'],
      [1, 'Task failed', 'agent_failed'],
    ]) {
      const output = path.join(directory, 'output');
      writeFileSync(output, '');
      writeFileSync(path.join(directory, 'opencode-cli.log'), log);
      const result = spawnSync('python3', ['-'], {
        input: script,
        encoding: 'utf8',
        env: {
          ...process.env,
          RUNNER_TEMP: directory,
          GITHUB_OUTPUT: output,
          RESULT: String(code),
          OPENCODE_API_KEY: 'test-redaction-value',
        },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(output, 'utf8'), `reason=${expected}\n`);
      assert.doesNotMatch(result.stdout, /test-redaction-value|private-bearer-value/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
