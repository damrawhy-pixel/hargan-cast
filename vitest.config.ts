import { defineConfig } from 'vitest/config'

// Unit tests for the logic that needs no Electron, browser or account.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})
