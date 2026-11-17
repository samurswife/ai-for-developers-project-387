import { defineConfig } from 'vitest/config';
import { join } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: process.env.API_TESTS ? ['*.api.test.ts'] : ['*.smoke.test.ts'],
    testTimeout: 45_000,
    ...(process.env.BROWSER_ARTIFACT_DIR
      ? {
          reporters: ['default', 'json'],
          outputFile: join(process.env.BROWSER_ARTIFACT_DIR, 'test-results.json'),
        }
      : {}),
  },
});
