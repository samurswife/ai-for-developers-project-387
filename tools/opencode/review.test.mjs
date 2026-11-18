import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../../.github/workflows/opencode-review.yml', import.meta.url),
  'utf8',
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function source(id) {
  const step = workflow.split(`        id: ${id}\n`)[1]?.split(/(?=^      - name:|^  [\w-]+:)/m)[0];
  assert.ok(step, `Missing step ${id}`);
  return step
    .split('          script: |\n')[1]
    .trimEnd()
    .split('\n')
    .map((line) => line.slice(12))
    .join('\n');
}

function pull(overrides = {}) {
  return {
    number: 42,
    state: 'open',
    draft: false,
    title: 'Calendar',
    body: 'Specification #6',
    html_url: 'https://github.com/example/calendar/pull/42',
    changed_files: 1,
    user: { login: 'owner', type: 'User' },
    head: { sha: 'head-sha', ref: 'feature', repo: { full_name: 'example/calendar' } },
    base: { sha: 'base-sha', ref: 'main', repo: { full_name: 'example/calendar' } },
    ...overrides,
  };
}

async function execute(id, options = {}) {
  const event = options.event ?? pull();
  const current = options.current ?? event;
  const outputs = new Map();
  const calls = [];
  const failures = [];
  const files = new Map();
  if (options.events !== undefined)
    files.set('/runner-temp/opencode-review/events.jsonl', options.events);
  const env = {
    RUNNER_TEMP: '/runner-temp',
    REVIEW_SHA: event.head.sha,
    AGENT_OUTCOME: 'success',
    AGENT_EXIT_CODE: '0',
    CONTEXT_READY: 'true',
    ...options.env,
  };
  let pullReads = 0;
  const method = (name, run) => async (input) => {
    calls.push({ name, input });
    if (options.fail === name) throw new Error(`API failed: ${name}`);
    return { data: await run(input) };
  };
  const issueUrl = (owner, repo, number) =>
    `https://api.github.com/repos/${owner}/${repo}/issues/${number}`;
  const github = {
    rest: {
      pulls: {
        get: method('pull', () => (++pullReads > 1 && options.latest ? options.latest : current)),
        listFiles: method(
          'files',
          () =>
            options.changes ?? [
              { filename: 'app.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' },
            ],
        ),
        listReviewComments: method('review-comments', () => options.reviewComments ?? []),
        listReviews: method(
          'reviews',
          ({ page = 1 }) => options.reviewPages?.[page - 1] ?? options.reviews ?? [],
        ),
      },
      repos: {
        getCollaboratorPermissionLevel: method('permission', ({ username }) => ({
          permission: options.permissions?.[username] ?? options.permission ?? 'write',
        })),
        getContent: method('content', (input) => {
          if (options.missingFile === input.path) throw new Error('Missing file');
          const content =
            options.contents?.[input.path] ??
            (input.path === 'REVIEW.md' ? 'Trusted review criteria' : `${input.ref}:${input.path}`);
          return {
            type: 'file',
            encoding: 'base64',
            content: Buffer.from(content).toString('base64'),
          };
        }),
        getCombinedStatusForRef: method('statuses', () => ({
          total_count: 1,
          statuses: [{ context: 'legacy', state: 'success', target_url: 'status-url' }],
        })),
      },
      issues: {
        get: method('issue', ({ owner, repo, issue_number: number }) => ({
          url: issueUrl(owner, repo, number),
          html_url: `https://github.com/${owner}/${repo}/issues/${number}`,
          title: `Issue ${number}`,
          body: options.sourceBody ?? '',
        })),
        listComments: method('comments', ({ owner, repo, issue_number: number }) =>
          number === 42
            ? (options.comments ?? [])
            : [
                {
                  user: { login: 'owner', type: 'User' },
                  author_association: 'OWNER',
                  body: 'Approved',
                  issue_url: issueUrl(owner, repo, number),
                  html_url: `https://github.com/${owner}/${repo}/issues/${number}#issuecomment-123`,
                },
              ],
        ),
        getComment: method('source-comment', ({ owner, repo }) => ({
          user: { login: 'owner', type: 'User' },
          body: 'Approved',
          author_association: 'OWNER',
          html_url: 'approval-url',
          issue_url: issueUrl(owner, repo, options.wrongComment ? 999 : 5),
        })),
        createComment: method('publish', () => ({})),
      },
      checks: {
        listForRef: method('checks', () => ({
          total_count: 1,
          check_runs: [
            { name: 'check', status: 'in_progress', conclusion: null, html_url: 'check-url' },
          ],
        })),
      },
      actions: {
        listWorkflowRunsForRepo: method('runs', () => ({
          total_count: 1,
          workflow_runs: [
            { name: 'CI', status: 'in_progress', conclusion: null, html_url: 'run-url' },
          ],
        })),
      },
    },
    paginate: async (fn, input) => {
      const items = [];
      for (let page = 1; ; page++) {
        const { data } = await fn({ ...input, page });
        items.push(...data);
        if (data.length < input.per_page) return items;
      }
    },
  };
  const context = {
    payload: { pull_request: event, repository: { full_name: 'example/calendar' } },
    actor: options.actor ?? 'owner',
    repo: { owner: 'example', repo: 'calendar' },
    serverUrl: 'https://github.com',
    runId: 100,
  };
  const core = {
    setOutput: (key, value) => outputs.set(key, value),
    notice() {},
    setFailed: (message) => failures.push(message),
  };
  const fs = {
    mkdirSync() {},
    writeFileSync: (filename, content) => files.set(filename, content),
    existsSync: (filename) => files.has(filename),
    readFileSync: (filename) => files.get(filename),
  };
  await new AsyncFunction('github', 'context', 'core', 'require', 'process', source(id))(
    github,
    context,
    core,
    (name) => (name === 'node:fs' ? fs : path),
    { env },
  );
  return { outputs, calls, failures, files };
}

test('review admits humans with current write/admin rights', async () => {
  for (const permission of ['write', 'admin']) {
    assert.equal((await execute('authorize', { permission })).outputs.get('allowed'), 'true');
  }
  for (const permission of ['none', 'read', 'triage', 'maintain']) {
    assert.equal((await execute('authorize', { permission })).outputs.get('allowed'), 'false');
  }
});

test('OpenCode and release bots are admitted even without collaborator permissions', async () => {
  for (const login of ['opencode-agent[bot]', 'github-actions[bot]']) {
    const result = await execute('authorize', {
      event: pull({ user: { login, type: 'Bot' } }),
      actor: login,
      permission: 'none',
    });
    assert.equal(result.outputs.get('allowed'), 'true');
    assert.equal(result.calls.filter((call) => call.name === 'permission').length, 0);
  }
  const denied = await execute('authorize', {
    event: pull({ user: { login: 'unknown[bot]', type: 'Bot' } }),
  });
  assert.equal(denied.outputs.get('allowed'), 'false');
});

test('forks, other bases, closed/draft and stale PRs are denied before permissions and model setup', async () => {
  for (const current of [
    pull({ head: { sha: 'head-sha', repo: { full_name: 'attacker/fork' } } }),
    pull({ base: { ref: 'other', repo: { full_name: 'example/calendar' } } }),
    pull({ base: { ref: 'main', repo: { full_name: 'attacker/fork' } } }),
    pull({ state: 'closed' }),
    pull({ draft: true }),
    pull({ head: { sha: 'new-sha', repo: { full_name: 'example/calendar' } } }),
  ]) {
    for (const id of ['authorize', 'context']) {
      const result = await execute(id, { current });
      assert.equal(result.outputs.get(id === 'authorize' ? 'allowed' : 'ready'), 'false');
      assert.deepEqual(
        result.calls.map((call) => call.name),
        ['pull'],
      );
    }
  }
});

test('rerun initiator and revoked author rights are rechecked', async () => {
  for (const id of ['authorize', 'context']) {
    for (const username of ['owner', 'outsider']) {
      const result = await execute(id, {
        actor: 'owner',
        env: { GITHUB_TRIGGERING_ACTOR: 'outsider' },
        permissions: { [username]: 'read' },
      });
      assert.equal(result.outputs.get(id === 'authorize' ? 'allowed' : 'ready'), 'false');
    }
    await assert.rejects(execute(id, { fail: 'permission' }), /API failed/);
    await assert.rejects(execute(id, { fail: 'pull' }), /API failed/);
  }
});

test('context uses base criteria, exact-head snapshots, issue approvals, both comment channels and current CI', async () => {
  const result = await execute('context', {
    event: pull({
      body: 'Spec #6. Approval https://github.com/example/calendar/issues/5#issuecomment-123',
    }),
    comments: [{ user: { login: 'owner' }, body: 'General feedback', html_url: 'general-url' }],
    reviewComments: [
      {
        user: { login: 'owner' },
        body: 'Inline feedback',
        html_url: 'inline-url',
        path: 'app.ts',
        line: 2,
      },
    ],
  });
  assert.equal(result.outputs.get('ready'), 'true');
  const saved = JSON.parse(result.files.get('/runner-temp/opencode-review/context.json'));
  assert.equal(saved.trusted['REVIEW.md'], 'Trusted review criteria');
  assert.equal(saved.base_sha, 'base-sha');
  assert.equal(saved.head_sha, 'head-sha');
  assert.equal(saved.changes[0].content, 'head-sha:app.ts');
  assert.equal(
    saved.sources.find((item) => item.title === 'Issue 5').comments[0].association,
    'OWNER',
  );
  assert.deepEqual(
    saved.prior_comments.map((item) => item.body),
    ['General feedback', 'Inline feedback'],
  );
  assert.equal(saved.ci.checks[0].status, 'in_progress');
  for (const call of result.calls.filter((item) => ['checks', 'statuses'].includes(item.name)))
    assert.equal(call.input.ref, 'head-sha');
  assert.equal(result.calls.find((item) => item.name === 'runs').input.head_sha, 'head-sha');
  assert.ok(
    result.calls
      .filter((item) => item.name === 'content' && item.input.path !== 'app.ts')
      .every((item) => item.input.ref === 'base-sha'),
  );
});

test('a Request changes summary without discussion or inline comments reaches the next review', async () => {
  const review = {
    id: 91,
    user: { login: 'reviewer', type: 'User' },
    author_association: 'COLLABORATOR',
    state: 'CHANGES_REQUESTED',
    body: 'A booked interval can still be selected. Keep this problem in the next review.',
    commit_id: 'previous-head-sha',
    submitted_at: '2026-11-16T12:00:00Z',
    html_url: 'https://github.com/example/calendar/pull/42#pullrequestreview-91',
  };
  const result = await execute('context', { reviews: [review], comments: [], reviewComments: [] });
  const saved = JSON.parse(result.files.get('/runner-temp/opencode-review/context.json'));
  assert.equal(result.outputs.get('ready'), 'true');
  assert.deepEqual(saved.prior_comments, []);
  assert.deepEqual(saved.prior_reviews, [
    {
      author: 'reviewer',
      type: 'User',
      association: 'COLLABORATOR',
      state: 'CHANGES_REQUESTED',
      commit_id: 'previous-head-sha',
      submitted_at: review.submitted_at,
      url: review.html_url,
      body: review.body,
    },
  ]);
  assert.deepEqual(saved.gaps, []);
});

test('review summaries use pagination and retain the latest decisions across pages', async () => {
  const page = Array.from({ length: 100 }, (_, index) => ({
    body: `Review ${index}`,
    state: 'CHANGES_REQUESTED',
    commit_id: `sha-${index}`,
    html_url: `https://github.com/example/calendar/pull/42#pullrequestreview-${index}`,
  }));
  const result = await execute('context', {
    reviewPages: [
      page,
      [
        {
          body: 'The previously requested correction is accepted.',
          state: 'APPROVED',
          commit_id: 'head-sha',
          html_url: 'https://github.com/example/calendar/pull/42#pullrequestreview-100',
        },
      ],
    ],
  });
  const saved = JSON.parse(result.files.get('/runner-temp/opencode-review/context.json'));
  assert.deepEqual(
    result.calls.filter((call) => call.name === 'reviews').map((call) => call.input),
    [
      { owner: 'example', repo: 'calendar', pull_number: 42, per_page: 100, page: 1 },
      { owner: 'example', repo: 'calendar', pull_number: 42, per_page: 100, page: 2 },
    ],
  );
  assert.equal(saved.prior_reviews.length, 20);
  assert.equal(saved.prior_reviews[0].body, 'Review 81');
  assert.equal(saved.prior_reviews.at(-1).state, 'APPROVED');
  assert.equal(saved.prior_reviews.at(-1).commit_id, 'head-sha');
  assert.ok(saved.gaps.includes('Only the last 20 PR review summaries included'));
});

test('missing reviews and truncated review text are explicit gaps instead of silently empty history', async () => {
  const missing = await execute('context', { fail: 'reviews' });
  const missingContext = JSON.parse(missing.files.get('/runner-temp/opencode-review/context.json'));
  assert.equal(missing.outputs.get('ready'), 'true');
  assert.deepEqual(missingContext.prior_reviews, []);
  assert.ok(missingContext.gaps.includes('PR review summaries are unavailable'));
  const long = await execute('context', {
    reviews: [{ state: 'CHANGES_REQUESTED', body: 'x'.repeat(6001), html_url: 'review-url' }],
  });
  const longContext = JSON.parse(long.files.get('/runner-temp/opencode-review/context.json'));
  assert.equal(longContext.prior_reviews[0].body.length, 6000);
  assert.ok(longContext.gaps.includes('review-url: truncated at 6000 characters'));
});

test('missing required criteria fail closed, other missing evidence is recorded, and unrelated approval comments are rejected', async () => {
  await assert.rejects(execute('context', { missingFile: 'REVIEW.md' }), /Missing file/);
  const result = await execute('context', {
    event: pull({
      body: 'Approval https://github.com/example/calendar/issues/5#issuecomment-123; https://github.com/attacker/repo/issues/9',
    }),
    wrongComment: true,
    missingFile: 'app.ts',
  });
  const saved = JSON.parse(result.files.get('/runner-temp/opencode-review/context.json'));
  assert.ok(saved.gaps.some((gap) => gap.includes('app.ts: unavailable')));
  assert.ok(saved.gaps.some((gap) => gap.includes('example/calendar#5:123: unavailable')));
  assert.ok(saved.gaps.some((gap) => gap.includes('outside allowed repositories')));
  assert.equal(saved.sources.length, 0);
});

test('context includes the complete security workflow and long specification through their final lines', async () => {
  const filename = '.github/workflows/opencode-review.yml';
  const specification = `${'x'.repeat(17000)}\nEnd of specification`;
  const result = await execute('context', {
    changes: [{ filename, status: 'added', patch: workflow }],
    contents: { [filename]: workflow },
    sourceBody: specification,
  });
  const saved = JSON.parse(result.files.get('/runner-temp/opencode-review/context.json'));
  assert.equal(saved.changes[0].content, workflow);
  assert.equal(saved.changes[0].patch, workflow);
  assert.equal(saved.sources[0].body, specification);
  assert.match(saved.changes[0].content, /if \(reason\) core.setFailed/);
  assert.ok(!saved.gaps.some((gap) => gap.includes('truncated')));
});

test('a push during collection stops the model and source traversal is bounded', async () => {
  const result = await execute('context', { latest: pull({ head: { sha: 'new-sha' } }) });
  assert.equal(result.outputs.get('ready'), 'false');
  const bounded = await execute('context', {
    event: pull({ body: Array.from({ length: 30 }, (_, index) => `#${index + 1}`).join(' ') }),
  });
  const saved = JSON.parse(bounded.files.get('/runner-temp/opencode-review/context.json'));
  assert.equal(saved.sources.length, 20);
  assert.ok(saved.gaps.some((gap) => gap.includes('Source traversal stopped')));
});

test('changed-file truncation and missing patches are visible review gaps', async () => {
  const result = await execute('context', {
    event: pull({ changed_files: 32 }),
    changes: Array.from({ length: 31 }, (_, index) => ({
      filename: `file-${index}.ts`,
      status: 'added',
    })),
  });
  const saved = JSON.parse(result.files.get('/runner-temp/opencode-review/context.json'));
  assert.equal(saved.changes.length, 30);
  assert.ok(saved.gaps.some((gap) => gap.includes('list is incomplete')));
  assert.ok(saved.gaps.some((gap) => gap.includes('first 30')));
  assert.ok(saved.gaps.some((gap) => gap.includes('patch:file-0.ts: unavailable')));
});

const textEvent = (text) => JSON.stringify({ type: 'text', part: { text } });

test('the observed duration-only response fails review instead of producing a green check', async () => {
  const result = await execute('publish', {
    events: [textEvent('21.1s'), textEvent('21.1s')].join('\n'),
  });
  assert.equal(result.failures.length, 1);
  assert.match(result.calls.find((call) => call.name === 'publish').input.body, /agent_failed/);
});

test('publisher posts only final text with checked SHA/model/log link, without reasoning or tool output', async () => {
  const result = await execute('publish', {
    events: [
      textEvent('No confirmed defects'),
      JSON.stringify({ type: 'reasoning', part: { text: 'private thinking' } }),
      JSON.stringify({ type: 'tool_use', part: { text: 'tool output' } }),
    ].join('\n'),
  });
  const published = result.calls.find((call) => call.name === 'publish').input.body;
  assert.match(published, /No confirmed defects/);
  assert.match(published, /head-sha/);
  assert.match(published, /opencode\/minimax-m3/);
  assert.match(published, /actions\/runs\/100/);
  assert.doesNotMatch(published, /private thinking|tool output/);
  assert.deepEqual(result.failures, []);
});

test('publisher suppresses obsolete, draft, fork and closed PR results', async () => {
  for (const current of [
    pull({ state: 'closed' }),
    pull({ draft: true }),
    pull({ head: { sha: 'new-sha', repo: { full_name: 'example/calendar' } } }),
    pull({ head: { sha: 'head-sha', repo: { full_name: 'attacker/fork' } } }),
  ]) {
    const result = await execute('publish', { current, events: textEvent('old review') });
    assert.equal(result.calls.filter((call) => call.name === 'publish').length, 0);
  }
});

test('timeout, infra, missing output, malformed events, zero-exit model errors are reported without raw error disclosure', async () => {
  for (const [options, reason] of [
    [{ env: { AGENT_EXIT_CODE: '124', AGENT_OUTCOME: 'failure' } }, 'timeout'],
    [{ env: { AGENT_EXIT_CODE: '137', AGENT_OUTCOME: 'failure' } }, 'timeout'],
    [{ env: { AGENT_EXIT_CODE: '3', AGENT_OUTCOME: 'failure' } }, 'infra'],
    [{ env: { AGENT_EXIT_CODE: '', AGENT_OUTCOME: 'skipped' } }, 'infra'],
    [{ env: { CONTEXT_READY: 'false' } }, 'infra'],
    [
      {
        events: JSON.stringify({
          type: 'error',
          error: { message: '401 invalid API key secret-value' },
        }),
      },
      'infra',
    ],
    [{ events: '' }, 'agent_failed'],
    [{ events: 'not JSON' }, 'agent_failed'],
    [
      { events: JSON.stringify({ type: 'error', error: { message: 'provider secret-value' } }) },
      'agent_failed',
    ],
  ]) {
    const result = await execute('publish', options);
    const body = result.calls.find((call) => call.name === 'publish').input.body;
    assert.match(body, new RegExp(reason));
    assert.match(body, /Нужен человек/);
    assert.doesNotMatch(body, /secret-value/);
    assert.equal(result.failures.length, 1);
  }
});

test('all OpenCode paths select MiniMax M3 and the review has no checkout, token env, tools, OIDC or session continuation', () => {
  const authorizeJob = workflow.split('\n  review:\n')[0];
  const modelStep = workflow
    .split('      - name: Review with a fresh read-only session\n')[1]
    .split('      - name: Publish review')[0];
  assert.doesNotMatch(authorizeJob, /secrets\.|id-token:|pull-requests: write/);
  assert.doesNotMatch(
    workflow,
    /actions\/checkout|pull_request_target|opencode github run|id-token:|--continue|--session|--auto/,
  );
  assert.doesNotMatch(modelStep, /GITHUB_TOKEN|GH_TOKEN|github\.token/);
  assert.match(modelStep, /"permission":\{"\*":"deny"\}/);
  assert.match(modelStep, /"steps":2/);
  assert.match(modelStep, /OPENCODE_DISABLE_PROJECT_CONFIG: 'true'/);
  assert.match(modelStep, /timeout --signal=TERM --kill-after=20s 10m/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.equal(workflow.split('OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}').length - 1, 1);
  for (const name of ['opencode.yml', 'opencode-triage.yml', 'opencode-review.yml']) {
    const text = readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
    assert.match(text, /MODEL: opencode\/minimax-m3/);
    assert.match(text, /"small_model":"opencode\/minimax-m3"/);
    assert.doesNotMatch(text, /glm-5\.3-flash-free/);
  }
});
