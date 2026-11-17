import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    from: { type: 'string', default: '11aafe53c312e4eaacbece67ef2ab5d65e42111a' },
    to: { type: 'string', default: 'HEAD' },
  },
});

try {
  if (!values.from || !values.to)
    throw new Error('--from and --to must be non-empty Git revisions.');
  if (
    execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() ===
    'true'
  ) {
    throw new Error('Commit history lint requires a full clone; fetch the complete history first.');
  }
  const commits = execFileSync(
    'git',
    ['log', '--format=%H', '--end-of-options', `${values.from}..${values.to}`, '--'],
    { encoding: 'utf8' },
  ).trim();
  if (!commits) console.log('No commits in the selected range.');
  for (const commit of commits ? commits.split('\n') : []) {
    // Published squash message with a known body-max-line-length violation; see #32.
    if (commit === '5a121e816e4f18b95cb9728865f744407723bd2d') {
      console.warn(`Known published-message exception: ${commit} (#32)`);
      continue;
    }
    const message = execFileSync('git', ['show', '--no-patch', '--format=format:%B', commit, '--']);
    execFileSync(
      process.execPath,
      [
        fileURLToPath(import.meta.resolve('@commitlint/cli/cli.js')),
        '--config',
        fileURLToPath(new URL('../../commitlint.config.cjs', import.meta.url)),
      ],
      { input: message, stdio: ['pipe', 'inherit', 'inherit'] },
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = error.status || 1;
}
