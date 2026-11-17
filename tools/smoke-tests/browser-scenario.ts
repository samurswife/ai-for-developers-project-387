import { chromium, type Browser, type BrowserContextOptions, type Page } from 'playwright';
import { expect } from 'vitest';
import { startFrontend } from './apps.js';
import { browserEvidence } from './browser-evidence.js';

/** Each scenario owns a fresh backend, free ports, browser and cleanup. */
export async function browserScenario<Backend extends { url: string; close: () => Promise<void> }>(
  start: () => Promise<Backend>,
  pageOptions: BrowserContextOptions,
  run: (page: Page, url: string, backend: Backend) => Promise<void>,
) {
  const backend = await start();
  let frontend: Awaited<ReturnType<typeof startFrontend>> | undefined;
  let browser: Browser | undefined;
  let finishEvidence: Awaited<ReturnType<typeof browserEvidence>> | undefined;
  const scenarioErrors: unknown[] = [];
  const cleanupErrors: unknown[] = [];
  try {
    frontend = await startFrontend(backend.url);
    browser = await chromium.launch();
    const context = await browser.newContext(pageOptions);
    finishEvidence = await browserEvidence(context);
    context.setDefaultTimeout(5000);
    const errors: string[] = [];
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
    const page = await context.newPage();
    await run(page, frontend.url, backend);
    expect(errors).toEqual([]);
  } catch (error) {
    scenarioErrors.push(error);
  } finally {
    try {
      await finishEvidence?.();
    } catch (error) {
      cleanupErrors.push(error);
    }
    const cleanup = await Promise.allSettled([
      browser?.close(),
      frontend?.close(),
      backend.close(),
    ]);
    cleanupErrors.push(
      ...cleanup.filter((result) => result.status === 'rejected').map((result) => result.reason),
    );
  }
  if (cleanupErrors.length)
    throw new AggregateError([...scenarioErrors, ...cleanupErrors], 'Application cleanup failed');
  if (scenarioErrors.length) throw scenarioErrors[0];
}
