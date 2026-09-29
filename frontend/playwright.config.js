import { defineConfig } from '@playwright/test';

if (process.env.CI && !process.env.TEST_DATABASE_URL) throw new Error('CI browser pilot requires TEST_DATABASE_URL; do not silently skip authenticated coverage');

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [{
    command: 'node e2e/serve-frontend.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  }, ...(process.env.TEST_DATABASE_URL ? [{
    command: 'node ../backend/scripts/browser-pilot-server.js',
    url: 'http://127.0.0.1:4317/api/readiness',
    reuseExistingServer: false,
  }] : [])],
});
