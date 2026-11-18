import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const stylelint = createRequire(import.meta.resolve('stylelint'));
const micromatch = createRequire(stylelint.resolve('micromatch'));
const cruiser = createRequire(import.meta.resolve('dependency-cruiser'));
const paths = [micromatch.resolve('picomatch'), cruiser.resolve('picomatch')];

for (const filename of paths) {
  const require = createRequire(filename);
  const version = require('./package.json').version;
  test(`picomatch ${version} bounds repeated single-branch wildcards and preserves ordinary globs`, () => {
    const program = `
      const assert = require('node:assert/strict');
      const pm = require(${JSON.stringify(filename)});
      for (const pattern of ['+(*a)', '*(*a)', '+(*)', '*(*)', '+(**a)', 'src/+(*a).js']) {
        assert.equal(pm.isMatch('a'.repeat(45) + '!', pattern), false);
        assert.equal(pm.isMatch(pattern, pattern), true);
      }
      assert.equal(pm.isMatch('src/calendar.ts', 'src/**/*.ts'), true);
      assert.equal(pm.isMatch('src/calendar.js', 'src/**/*.ts'), false);
      assert.equal(pm.isMatch('abab', '+(a|b)'), true);
      assert.equal(pm.isMatch('abc', '+(a|b)'), false);
      assert.equal(pm.isMatch('abc', '+(abc)'), true);
      assert.equal(pm.isMatch('a*b', '+(a\\\\*b)'), true);
    `;
    const result = spawnSync(process.execPath, ['-e', program], {
      timeout: 2000,
      encoding: 'utf8',
    });
    assert.equal(result.error, undefined, `ReDoS timeout: ${result.error?.message}`);
    assert.equal(result.status, 0, result.stderr);
  });
}

test('every picomatch version in the lockfile is covered by the installed checks', () => {
  const lockfile = readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8');
  const versions = [
    ...new Set([...lockfile.matchAll(/picomatch@(\d+\.\d+\.\d+)/g)].map((m) => m[1])),
  ].sort();
  const installed = [
    ...new Set(paths.map((p) => createRequire(p)('./package.json').version)),
  ].sort();
  assert.deepEqual(versions, installed);
});
