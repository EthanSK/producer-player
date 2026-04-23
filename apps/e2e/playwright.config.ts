import { defineConfig } from '@playwright/test';

// Local macOS Electron runs are intentionally single-worker so one hidden app instance
// doesn't become several competing launches that keep tugging focus back.
const defaultWorkers = process.platform === 'darwin' ? '1' : process.env.CI ? '4' : '10';
const configuredWorkers = Number.parseInt(
  process.env.PLAYWRIGHT_WORKERS ?? defaultWorkers,
  10
);

export default defineConfig({
  testDir: './src',
  fullyParallel: true,
  workers: Number.isFinite(configuredWorkers) && configuredWorkers > 0 ? configuredWorkers : 10,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
