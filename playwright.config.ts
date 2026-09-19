import { defineConfig, devices } from '@playwright/test';
import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const firefoxData = resolve('.tmp/firefox-app-data');
mkdirSync(firefoxData, { recursive: true });
const port = process.env.ANNIE_TEST_PORT
  ? Number(process.env.ANNIE_TEST_PORT)
  : await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        server.close(() => resolve(port));
      });
    });
process.env.ANNIE_TEST_PORT = String(port);
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.browser.spec.ts',
  fullyParallel: true,
  workers: 3,
  timeout: 30000,
  expect: { timeout: 6000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: { env: { ...process.env, MOZ_APP_DATA: firefoxData } },
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `node scripts/test-server.mjs ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
