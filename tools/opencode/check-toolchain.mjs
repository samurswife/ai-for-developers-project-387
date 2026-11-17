import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function verifyToolchain(before, after) {
  function installed(snapshot) {
    assert.ok(
      snapshot.node?.length && snapshot.pnpm?.length,
      'Project Node.js and pnpm must be present',
    );
    return Object.fromEntries(
      Object.entries(snapshot)
        .sort()
        .map(([tool, versions]) => [
          tool,
          versions.map((entry) => {
            assert.equal(entry.installed, true, `${tool}@${entry.version} is not installed`);
            assert.ok(entry.install_path, `${tool} install path is missing`);
            return { version: entry.version, path: entry.install_path };
          }),
        ]),
    );
  }
  assert.deepEqual(
    installed(after),
    installed(before),
    'Prepared tool versions and paths must survive XDG_DATA_HOME changes',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyToolchain(
    ...process.argv.slice(2, 4).map((file) => JSON.parse(readFileSync(file, 'utf8'))),
  );
  console.log('Prepared mise tools retained: every version is installed at its original path.');
}
