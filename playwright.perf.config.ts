import { defineConfig } from '@playwright/test';
import config from './playwright.config';
export default defineConfig({
  ...config,
  testMatch: '**/perf/*.spec.ts',
  workers: 1,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  use: { ...config.use, trace: 'on' },
  outputDir: 'performance-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'performance-report' }]],
});
