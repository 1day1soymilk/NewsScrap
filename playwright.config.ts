import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  reporter: 'list',
  // These two settings are a pair: trace is only captured on a retry, so
  // without retries > 0 'on-first-retry' never fires and no trace is ever recorded.
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      // viewport MUST come after the spread: devices['Desktop Chrome'] carries
      // 1280x720, and HeadlinePanel (fixed right-0, 320px wide) overlaps the
      // centred word cloud on shorter viewports.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
