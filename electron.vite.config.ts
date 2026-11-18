import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// The ported token classes redeclare `data`, set by their base constructor.
// Define semantics would reset it to undefined after super() returns.
const legacyClassFields = { tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } } }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    esbuild: legacyClassFields,
    // Discord presence turns on only in builds given an application id.
    define: { __DISCORD_CLIENT_ID__: JSON.stringify(process.env.HC_DISCORD_CLIENT_ID ?? '') },
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') } } },
  },
  renderer: {
    root: 'src/renderer',
    define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? JSON.parse(readFileSync('package.json', 'utf8')).version) },
    plugins: [react()],
    esbuild: { drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [] },
    // The Xbox player's EventBus expects Node's `events`.
    resolve: { alias: { events: resolve('node_modules/events/events.js') } },
    worker: { format: 'es' },
    build: {
      target: 'chrome130',
      modulePreload: { polyfill: false },
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } },
    },
  },
})
