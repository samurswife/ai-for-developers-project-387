import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { actionFor, verifyPermissions } from './check-permissions.mjs';

const workflow = readFileSync(
  new URL('../../.github/workflows/opencode.yml', import.meta.url),
  'utf8',
);

function runtimeConfig(text = workflow) {
  const inline = text.match(/OPENCODE_CONFIG_CONTENT: '(.*)'/);
  if (inline) return JSON.parse(inline[1]);
  return JSON.parse(text.match(/OPENCODE_CONFIG_CONTENT: >-\n([^\n]+)/)?.[1].trim() ?? '{}');
}

test('manual CI explicitly refuses unattended permission prompts', () => {
  const { permission } = runtimeConfig();
  assert.equal(permission?.external_directory?.['*'], 'deny');
  assert.equal(permission?.doom_loop, 'deny');
  assert.equal(permission?.question, 'deny');
  assert.equal(permission?.read?.['*.env'], 'deny');
  assert.equal(permission?.read?.['*.env.*'], 'deny');
  assert.equal(permission?.external_directory?.['${{ runner.temp }}/opencode-work/*'], 'allow');
  assert.doesNotMatch(JSON.stringify(permission), /"ask"/);
});

function shellStep(name) {
  return workflow
    .split(`      - name: ${name}\n`)[1]
    .split(/(?=^      - name:|^      #)/m)[0]
    .split('        run: |\n')[1]
    .trimEnd()
    .split('\n')
    .map((line) => line.slice(10))
    .join('\n');
}

test('compiled-rule checks reject the captured permission wait and respect later overrides', () => {
  const before = [
    { permission: '*', pattern: '*', action: 'allow' },
    { permission: 'external_directory', pattern: '*', action: 'ask' },
  ];
  assert.equal(actionFor(before, 'external_directory', '/home/runner/*'), 'ask');
  assert.throws(
    () => verifyPermissions({ name: 'build', permission: before }, '/tmp/work'),
    /external_directory/,
  );
  assert.equal(
    actionFor(
      [...before, { permission: 'external_directory', pattern: '*', action: 'deny' }],
      'external_directory',
      '/home/runner/*',
    ),
    'deny',
  );
});

test(
  'pinned CLI compiles the actual workflow policy; missing CI overrides reproduce the wait',
  {
    skip: process.env.OPENCODE_PERMISSION_PROBE !== 'true',
    timeout: 120_000,
  },
  () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'opencode-permissions-'));
    const env = {
      ...process.env,
      RUNNER_TEMP: directory,
      GITHUB_PATH: path.join(directory, 'github-path'),
      XDG_DATA_HOME: path.join(directory, 'opencode-work', 'data'),
      XDG_CACHE_HOME: path.join(directory, 'cache'),
      XDG_CONFIG_HOME: path.join(directory, 'config'),
      XDG_STATE_HOME: path.join(directory, 'state'),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(runtimeConfig()).replaceAll(
        '${{ runner.temp }}',
        directory,
      ),
    };
    delete env.OPENCODE_API_KEY;
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    const execute = (command, args, extra = {}) => {
      const result = spawnSync(command, args, {
        env: { ...env, ...extra },
        encoding: 'utf8',
        timeout: 90_000,
      });
      assert.equal(
        result.status,
        0,
        `${command}: ${result.error?.message ?? ''}\n${result.stderr}\n${result.stdout}`,
      );
      return result.stdout;
    };
    try {
      writeFileSync(env.GITHUB_PATH, '');
      if (process.env.OPENCODE_TEST_CLI) {
        env.PATH = `${path.dirname(process.env.OPENCODE_TEST_CLI)}${path.delimiter}${env.PATH}`;
      } else {
        execute('bash', ['-c', shellStep('Install OpenCode v1.19.4')]);
        const bin = readFileSync(env.GITHUB_PATH, 'utf8').trim();
        env.PATH = `${bin}${path.delimiter}${env.PATH}`;
      }
      assert.match(execute('opencode', ['--version']), /1\.19\.4/);
      // These are the same commands run before the real GitHub agent, without a model key.
      execute('bash', ['-c', shellStep('Verify unattended permissions')]);
      const allowed = path.join(directory, 'opencode-work', 'probe.txt');
      const outside = path.join(directory, 'outside.txt');
      writeFileSync(allowed, 'TEMP_WORKSPACE_OK');
      writeFileSync(outside, 'OUTSIDE_WORKSPACE');
      assert.match(
        execute('opencode', [
          'debug',
          'agent',
          'build',
          '--tool',
          'read',
          '--params',
          JSON.stringify({ filePath: allowed }),
        ]),
        /TEMP_WORKSPACE_OK/,
      );
      const denied = spawnSync(
        'opencode',
        [
          'debug',
          'agent',
          'build',
          '--tool',
          'read',
          '--params',
          JSON.stringify({ filePath: outside }),
        ],
        {
          env,
          encoding: 'utf8',
          timeout: 10_000,
        },
      );
      assert.equal(
        denied.error,
        undefined,
        'Permission denial must return without an interactive wait',
      );
      assert.notEqual(denied.status, 0);
      assert.match(
        denied.stderr + denied.stdout,
        /rule which prevents you from using this specific tool call/,
      );
      const before = JSON.parse(
        execute('opencode', ['debug', 'agent', 'build'], {
          OPENCODE_CONFIG_CONTENT:
            '{"model":"opencode/minimax-m3","small_model":"opencode/minimax-m3"}',
        }),
      );
      assert.equal(actionFor(before.permission, 'external_directory', '/home/runner/*'), 'ask');
      assert.throws(
        () => verifyPermissions(before, path.join(directory, 'opencode-work')),
        /external_directory/,
      );
      console.log(
        'Pinned CLI: former /home/runner/* permission is ask; CI policy rejects it immediately. No model invocation.',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test('locked project tools and setup precede the model and remain behind the budget', () => {
  const execution = workflow.split('\n  opencode:\n')[1];
  const budget = execution.indexOf('id: budget');
  const tools = execution.indexOf('name: Install mise and tools');
  const setup = execution.indexOf('name: Install dependencies and Chromium');
  const permissions = execution.indexOf('name: Verify unattended permissions');
  const model = execution.indexOf('name: Run OpenCode');
  assert.ok(
    budget >= 0 && tools > budget && setup > tools && permissions > setup && model > permissions,
  );
  assert.match(execution, /jdx\/mise-action@[a-f0-9]{40}/);
  assert.match(execution, /install_args: --locked/);
  assert.match(execution, /run: mise run setup/);
  for (const name of [
    'Install mise and tools',
    'Install dependencies and Chromium',
    'Verify unattended permissions',
  ]) {
    const step = execution.split(`      - name: ${name}\n`)[1]?.split('      - name:')[0];
    assert.match(step ?? '', /if: steps\.budget\.outputs\.allowed == 'true'/);
    assert.match(step ?? '', /timeout-minutes: \d+/);
    assert.doesNotMatch(step ?? '', /secrets\.|continue-on-error: true/);
  }
});
