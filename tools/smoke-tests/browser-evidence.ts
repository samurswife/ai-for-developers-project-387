import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import { expect } from 'vitest';

/** Opt-in evidence for every context, saved before browser cleanup on success and failure. */
export async function browserEvidence(context: BrowserContext) {
  const directory = process.env.BROWSER_ARTIFACT_DIR;
  if (!directory) return async () => {};
  const state = expect.getState();
  const title = state.currentTestName;
  if (!title) throw new Error('Browser evidence requires a current test name');
  const output = join(directory, 'scenarios', randomUUID());
  await mkdir(output, { recursive: true });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true, title });
  return async () => {
    const screenshots: string[] = [];
    const errors: unknown[] = [];
    for (const [index, page] of context.pages().entries()) {
      if (page.isClosed()) continue;
      const name = `page-${index}.png`;
      try {
        await page.screenshot({ path: join(output, name), fullPage: true, timeout: 5000 });
        screenshots.push(name);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await context.tracing.stop({ path: join(output, 'trace.zip') });
    } catch (error) {
      errors.push(error);
    }
    await writeFile(
      join(output, 'scenario.json'),
      JSON.stringify(
        {
          title: title.trim(),
          file: state.testPath,
          trace: 'trace.zip',
          screenshots,
          complete: errors.length === 0,
          recorded_at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    if (errors.length) throw new AggregateError(errors, 'Browser evidence recording failed');
  };
}
