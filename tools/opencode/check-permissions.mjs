import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function matches(pattern, value) {
  const expression = pattern
    .split('*')
    .map((part) =>
      part
        .split('?')
        .map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.'),
    )
    .join('.*');
  return new RegExp(`^${expression}$`, 's').test(value);
}

export function actionFor(rules, permission, pattern) {
  return (
    rules.findLast((rule) => matches(rule.permission, permission) && matches(rule.pattern, pattern))
      ?.action ?? 'ask'
  );
}

export function verifyPermissions(agent, temporaryDirectory) {
  assert.ok(Array.isArray(agent.permission), 'CLI did not return compiled permission rules');
  const rules = agent.permission;
  for (const [permission, pattern, expected] of [
    ['external_directory', '/home/runner/*', 'deny'],
    ['external_directory', '/home/runner/.n/*', 'deny'],
    ['external_directory', `${temporaryDirectory}/*`, 'allow'],
    ['external_directory', `${temporaryDirectory}-outside/*`, 'deny'],
    ['doom_loop', '*', 'deny'],
    ['question', '*', 'deny'],
    ['read', '/workspace/.env', 'deny'],
    ['read', '/workspace/.env.production', 'deny'],
    ['read', '/workspace/.env.example', 'allow'],
    ['read', '/workspace/README.md', 'allow'],
  ]) {
    assert.equal(
      actionFor(rules, permission, pattern),
      expected,
      `${agent.name}: ${permission} ${pattern}`,
    );
  }
  // Check effective rules: the CLI keeps defaults before the overriding CI rules.
  for (const rule of rules.filter((entry) => entry.action === 'ask')) {
    assert.notEqual(
      actionFor(rules, rule.permission, rule.pattern),
      'ask',
      `Interactive rule: ${rule.permission} ${rule.pattern}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyPermissions(JSON.parse(readFileSync(process.argv[2], 'utf8')), process.argv[3]);
  console.log(
    'Compiled OpenCode permissions passed: no interactive guards; external paths restricted.',
  );
}
