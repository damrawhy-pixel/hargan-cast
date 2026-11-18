import { defineConfig } from '@playwright/test'

// The Android app on a running emulator or a phone with USB debugging; the debug
// APK must be installed. CI does both (.github/workflows/mobile.yml).
export default defineConfig({
  testDir: 'tests/android',
  timeout: 120_000,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/android-report' }]],
  outputDir: 'test-results/android-artifacts',
})
