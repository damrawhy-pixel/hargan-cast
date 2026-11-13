import { defineConfig } from '@playwright/test'

// Drives the real Electron app (built into out/ by electron-vite) with a fresh
// profile per test; no accounts and no streams are involved.
export default defineConfig({
  testDir: 'tests/ui',
  timeout: 60_000,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/report' }]],
  outputDir: 'test-results/artifacts',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
})
