import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAuditTools } from './lighthouse-agent/tools/lighthouse.js';

const auditId = 'render-blocking-insight';
const target = 'https://calendar.example/';
const issueUrl = 'https://github.com/example/calendar/issues';
const bot = { login: 'github-actions[bot]' };

async function setup(
  t,
  {
    mode = 'live',
    findings = [{ auditId, title: 'Render-blocking requests', medianSavingsMs: 420 }],
    request,
    report = {},
    runId = '12345',
  } = {},
) {
  const runnerTemp = await mkdtemp(join(tmpdir(), 'lighthouse-agent-test-'));
  t.after(() => rm(runnerTemp, { recursive: true, force: true }));
  const directory = join(runnerTemp, 'lighthouse-analysis');
  await mkdir(join(directory, 'report'), { recursive: true });
  await writeFile(
    join(directory, 'report', 'summary.json'),
    JSON.stringify({
      status: 'collected',
      mode,
      profile: 'mobile',
      appUrl: target,
      performanceScores: [0.72, 0.8, 0.75],
      findings,
      ...report,
    }),
  );
  const tools = createAuditTools({
    env: {
      RUNNER_TEMP: runnerTemp,
      AUDIT_MODE: mode,
      AUDIT_TRACKING_ISSUE: '37',
      GITHUB_REPOSITORY: 'example/calendar',
      GITHUB_API_URL: 'https://api.github.com',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_RUN_ID: runId,
      GITHUB_TOKEN: 'test-token',
    },
    request,
  });
  const decisionPath = join(directory, 'decision.json');
  return { ...tools, readDecision: async () => JSON.parse(await readFile(decisionPath, 'utf8')) };
}

const finding = {
  status: 'new-finding',
  auditId,
  issueNumber: 0,
  summary: 'Таблица стилей блокирует отрисовку.',
  proposedAction: 'Отложить загрузку стилей, которые не нужны на первом экране.',
};

const noFindings = {
  status: 'no-findings',
  auditId: '',
  issueNumber: 0,
  summary: 'По порогу аудита находок нет.',
  proposedAction: '',
};

test('reads all pages of open and closed issues and records a source-backed duplicate', async (t) => {
  const seen = [];
  const tools = await setup(t, {
    request: async (url, options) => {
      const endpoint = new URL(url);
      assert.equal(endpoint.origin, 'https://api.github.com');
      assert.equal(endpoint.pathname, '/repos/example/calendar/issues');
      assert.equal(endpoint.searchParams.get('state'), 'all');
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      const page = endpoint.searchParams.get('page');
      seen.push(page);
      const entries =
        page === '1'
          ? [
              { number: 37, state: 'open', title: 'Audit tracking issue' },
              { number: 10, state: 'open', title: '[Учебный аудит] Учебная задача' },
              ...Array.from({ length: 98 }, () => ({ pull_request: {} })),
            ]
          : [{ number: 22, state: 'closed', title: 'Отложить блокирующие стили' }];
      return Response.json(entries);
    },
  });
  const data = JSON.parse(await tools.context.execute());
  assert.deepEqual(seen, ['1', '2']);
  assert.deepEqual(
    data.issues.map(({ number, state }) => [number, state]),
    [[22, 'closed']],
  );
  const duplicate = { ...finding, status: 'duplicate', issueNumber: 22, proposedAction: '' };
  await assert.rejects(tools.decide.execute({ ...duplicate, issueNumber: 99 }), /retrieved list/);
  await tools.decide.execute(duplicate);
  assert.deepEqual(await tools.readDecision(), {
    ...duplicate,
    mode: 'live',
    publication: { action: 'existing-issue', url: `${issueUrl}/22` },
  });
});

test('publishes one triage issue with concrete report evidence and a run link', async (t) => {
  const created = [];
  const tools = await setup(t, {
    request: async (url, { method, body }) => {
      assert.equal(new URL(url).pathname, '/repos/example/calendar/issues');
      if (method === 'GET') return Response.json([]);
      created.push(JSON.parse(body));
      return Response.json({ number: 56 }, { status: 201 });
    },
  });
  await assert.rejects(tools.decide.execute(finding), /Call lighthouse_context/);
  await tools.context.execute();
  await assert.rejects(tools.decide.execute({ ...finding, auditId: 'imagined-insight' }), /absent/);
  await assert.rejects(tools.decide.execute({ ...finding, proposedAction: '' }), /proposed action/);
  const attempts = await Promise.allSettled([
    tools.decide.execute(finding),
    tools.decide.execute(finding),
  ]);
  assert.equal(attempts[0].status, 'fulfilled');
  assert.match(attempts[1].reason.message, /already been attempted/);
  assert.equal(created.length, 1);
  const [issue] = created;
  assert.deepEqual(issue.labels, ['needs-triage']);
  assert.match(issue.title, /^\[Lighthouse\]/);
  assert.match(issue.body, /lighthouse-audit:finding:live:[a-f0-9]{64}/);
  assert.match(issue.body, /Сервис «Запись на звонок»/);
  assert.match(issue.body, /render-blocking-insight/);
  assert.match(issue.body, /420 мс/);
  assert.match(issue.body, /Отложить загрузку стилей/);
  assert.match(issue.body, /https:\/\/github.com\/example\/calendar\/actions\/runs\/12345/);
  assert.deepEqual((await tools.readDecision()).publication, {
    action: 'issue-created',
    url: `${issueUrl}/56`,
  });
});

test('repeating the demo links the same closed issue and keeps it out of a live audit', async (t) => {
  const issues = [];
  const request = async (url, { method, body }) => {
    assert.equal(new URL(url).pathname, '/repos/example/calendar/issues');
    if (method === 'GET') return Response.json(issues);
    const issue = { ...JSON.parse(body), number: 56, state: 'open', user: bot };
    issues.push(issue);
    return Response.json(issue, { status: 201 });
  };
  const first = await setup(t, { mode: 'demo', request });
  await first.context.execute();
  await first.decide.execute(finding);
  assert.equal(issues.length, 1);
  assert.match(issues[0].title, /^\[Учебный аудит\]/);
  assert.deepEqual(issues[0].labels, []);
  assert.match(issues[0].body, /Учебная находка. Замеры приложения не выполнялись./);
  issues[0].state = 'closed';
  issues[0].title = 'Уточнённое название';
  const repeat = await setup(t, { mode: 'demo', request, runId: '12346' });
  assert.deepEqual(JSON.parse(await repeat.context.execute()).recordedIssues, [
    { auditId, number: 56 },
  ]);
  await repeat.decide.execute(finding);
  assert.equal(issues.length, 1);
  assert.deepEqual((await repeat.readDecision()).publication, {
    action: 'existing-issue',
    url: `${issueUrl}/56`,
  });
  const live = await setup(t, { request, runId: '12347' });
  const context = JSON.parse(await live.context.execute());
  assert.deepEqual(context.recordedIssues, []);
  assert.deepEqual(context.issues, []);
});

test('a repeat with no findings links the original tracker comment without posting again', async (t) => {
  const comments = [];
  const request = async (url, { method, body }) => {
    const path = new URL(url).pathname;
    if (path === '/repos/example/calendar/issues/37' && method === 'GET') {
      return Response.json({ number: 37 });
    }
    assert.equal(path, '/repos/example/calendar/issues/37/comments');
    if (method === 'GET') return Response.json(comments);
    const comment = { ...JSON.parse(body), id: 321, user: bot };
    comments.push(comment);
    return Response.json(comment, { status: 201 });
  };
  for (const [runId, action] of [
    ['12345', 'comment-posted'],
    ['12346', 'existing-comment'],
  ]) {
    const tools = await setup(t, { findings: [], request, runId });
    await tools.context.execute();
    await tools.decide.execute(noFindings);
    assert.deepEqual((await tools.readDecision()).publication, {
      action,
      url: `${issueUrl}/37#issuecomment-321`,
    });
  }
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /Lighthouse-аудит без находок/);
  assert.match(comments[0].body, /actions\/runs\/12345/);
});

test('reports from a different mode and incomplete issue lookups cannot produce a decision', async (t) => {
  const mismatched = await setup(t, { mode: 'demo', report: { mode: 'live' } });
  await assert.rejects(mismatched.context.execute(), /summary from this run/);
  await assert.rejects(mismatched.decide.execute(finding), /Call lighthouse_context/);
  const failed = await setup(t, { request: async () => new Response(null, { status: 503 }) });
  await assert.rejects(failed.context.execute(), /HTTP 503/);
  await assert.rejects(failed.decide.execute(finding), /Call lighthouse_context/);
});

test('checks for duplicates again before attempting mutation and stops on a failed read', async (t) => {
  let calls = 0;
  const tools = await setup(t, {
    request: async (url, { method }) => {
      assert.equal(method, 'GET');
      return ++calls === 1 ? Response.json([]) : new Response(null, { status: 503 });
    },
  });
  await tools.context.execute();
  await assert.rejects(tools.decide.execute(finding), /HTTP 503/);
  await assert.rejects(tools.decide.execute(finding), /already been attempted/);
  await assert.rejects(tools.readDecision(), { code: 'ENOENT' });
  assert.equal(calls, 2);
});

test('a new run recovers the existing issue when GitHub created it before the response was lost', async (t) => {
  const issues = [];
  const request = async (url, { method, body }) => {
    assert.equal(new URL(url).pathname, '/repos/example/calendar/issues');
    if (method === 'GET') return Response.json(issues);
    issues.push({ ...JSON.parse(body), number: 56, state: 'open', user: bot });
    throw new Error('Connection lost after creation.');
  };
  const first = await setup(t, { request });
  await first.context.execute();
  await assert.rejects(first.decide.execute(finding), /Connection lost/);
  await assert.rejects(first.readDecision(), { code: 'ENOENT' });

  const repeat = await setup(t, { request, runId: '12346' });
  await repeat.context.execute();
  await repeat.decide.execute(finding);
  assert.equal(issues.length, 1);
  assert.deepEqual((await repeat.readDecision()).publication, {
    action: 'existing-issue',
    url: `${issueUrl}/56`,
  });
});
