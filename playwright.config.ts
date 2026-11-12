import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  // Several specs measure hover intent and animation deadlines in real time,
  // which a loaded runner can stretch. One retry in CI keeps such a stall from
  // blocking a deploy; Playwright still lists the test as flaky in the report.
  // Locally a failure fails at once.
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:4179', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
  webServer: {
    command: 'pnpm exec vite --config tests/browser/vite.config.ts',
    url: 'http://127.0.0.1:4179/tests/browser/',
    reuseExistingServer: !process.env.CI,
  },
});
