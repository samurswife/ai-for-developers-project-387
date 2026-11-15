import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../../.github/workflows/opencode-triage.yml', import.meta.url),
  'utf8',
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Execute the JavaScript embedded in the workflow, so fixtures exercise the actual guards.
function guardSource(id) {
  const step = workflow.split(`        id: ${id}\n`)[1]?.split(/(?=^      - name:|^  [\w-]+:)/m)[0];
  assert.ok(step, `Workflow step ${id} is missing.`);
  const source = step.split('          script: |\n')[1];
  assert.ok(source, `Workflow step ${id} must contain a JavaScript guard.`);
  return source
    .trimEnd()
    .split('\n')
    .map((line) => {
      assert.ok(!line || line.startsWith('            '));
      return line.slice(12);
    })
    .join('\n');
}

function issue(overrides = {}) {
  return {
    number: 42,
    state: 'open',
    user: { login: 'owner', type: 'User' },
    author_association: 'OWNER',
    labels: [],
    ...overrides,
  };
}

async function execute(id, options = {}) {
  const payload = options.payload ?? issue();
  const live = options.live ?? payload;
  const output = new Map();
  const calls = [];
  const github = {
    rest: {
      repos: {
        async getCollaboratorPermissionLevel(input) {
          calls.push({ operation: 'permission', input });
          if (options.permissionError) throw new Error('Permission API failed.');
          return { data: { permission: options.permission ?? 'admin' } };
        },
      },
      issues: {
        async get(input) {
          calls.push({ operation: 'issue', input });
          if (options.issueError) throw new Error('Issue API failed.');
          return { data: live };
        },
      },
    },
  };
  const context = {
    actor: options.actor ?? payload.user?.login,
    payload: { issue: payload },
    repo: { owner: 'example', repo: 'calendar' },
  };
  const core = {
    setOutput: (name, value) => output.set(name, value),
    notice() {},
  };
  await new AsyncFunction('github', 'context', 'core', guardSource(id))(github, context, core);
  return { output, calls };
}

test('trusted authors with current write/admin access may start triage', async () => {
  for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
    for (const permission of ['admin', 'write']) {
      const { output, calls } = await execute('authorize', {
        payload: issue({ author_association: association }),
        permission,
      });
      assert.equal(output.get('allowed'), 'true');
      assert.deepEqual(
        calls.map((call) => call.operation),
        ['permission', 'issue'],
      );
      assert.deepEqual(calls[0].input, {
        owner: 'example',
        repo: 'calendar',
        username: 'owner',
      });
      assert.equal(calls[1].input.issue_number, 42);
    }
  }
});

test('bots and missing authors are rejected before any API call', async () => {
  for (const user of [{ login: 'agent[bot]', type: 'Bot' }, undefined]) {
    const { output, calls } = await execute('authorize', { payload: issue({ user }) });
    assert.equal(output.get('allowed'), 'false');
    assert.deepEqual(calls, []);
  }
});

test('untrusted associations and mismatching actors are rejected before any API call', async () => {
  for (const association of ['NONE', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', undefined]) {
    const result = await execute('authorize', {
      payload: issue({ author_association: association }),
    });
    assert.equal(result.output.get('allowed'), 'false');
    assert.deepEqual(result.calls, []);
  }
  const result = await execute('authorize', { actor: 'another-user' });
  assert.equal(result.output.get('allowed'), 'false');
  assert.deepEqual(result.calls, []);
});

test('both guards reject insufficient or revoked current permissions', async () => {
  for (const id of ['authorize', 'ready']) {
    for (const permission of ['none', 'read', 'triage', 'maintain']) {
      const { output, calls } = await execute(id, { permission });
      assert.equal(output.get(id === 'authorize' ? 'allowed' : 'ready'), 'false');
      assert.equal(calls.length, 1);
    }
  }
});

test('both guards skip prepared labels and closed issues using the current API state', async () => {
  for (const id of ['authorize', 'ready']) {
    for (const name of ['ready-for-agent', 'ready-for-human', 'wontfix']) {
      const { output } = await execute(id, {
        payload: issue(),
        live: issue({ labels: [{ name: 'enhancement' }, { name }] }),
      });
      assert.equal(output.get(id === 'authorize' ? 'allowed' : 'ready'), 'false');
    }
    const { output } = await execute(id, { live: issue({ state: 'closed' }) });
    assert.equal(output.get(id === 'authorize' ? 'allowed' : 'ready'), 'false');
  }
});

test('a ticket created with ready-for-agent is skipped before checkout', async () => {
  const { output } = await execute('authorize', {
    payload: issue({ labels: [{ name: 'ready-for-agent' }] }),
  });
  assert.equal(output.get('allowed'), 'false');
});

test('a label added after authorization stops the agent at the second guard', async () => {
  const payload = issue();
  assert.equal((await execute('authorize', { payload })).output.get('allowed'), 'true');
  const { output } = await execute('ready', {
    payload,
    live: issue({ labels: [{ name: 'ready-for-agent' }] }),
  });
  assert.equal(output.get('ready'), 'false');
});

test('the second guard admits an issue that is still open and unprepared', async () => {
  assert.equal((await execute('ready')).output.get('ready'), 'true');
});

test('API errors fail closed rather than producing a successful guard result', async () => {
  for (const id of ['authorize', 'ready']) {
    await assert.rejects(execute(id, { permissionError: true }), /Permission API failed/);
    await assert.rejects(execute(id, { issueError: true }), /Issue API failed/);
  }
});

test('authorization precedes checkout and the secret is bound only to a guarded agent step', () => {
  const authorizeJob = workflow.split('\n  triage:\n')[0];
  assert.doesNotMatch(authorizeJob, /actions\/checkout/);
  assert.doesNotMatch(authorizeJob, /OPENCODE_API_KEY|id-token: write/);
  assert.match(
    workflow,
    /- name: Run OpenCode\n\s+if: steps\.ready\.outputs\.ready == 'true'\n\s+run: opencode github run/,
  );
  assert.equal(workflow.split('OPENCODE_API_KEY:').length - 1, 1);
});
