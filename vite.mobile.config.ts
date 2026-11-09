import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Builds the interface for the phone and tablet apps. Same renderer as the desktop,
// started through src/mobile, which provides window.hc without Electron.
export default defineConfig({
  root: 'src/mobile',
  base: './',
  publicDir: resolve('src/renderer/public'),
  plugins: [react()],
  esbuild: { drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [] },
  // The Xbox player's EventBus expects Node's `events`.
  resolve: { alias: { events: resolve('node_modules/events/events.js') } },
  worker: { format: 'es' },
  build: {
    outDir: resolve('dist-mobile'),
    emptyOutDir: true,
    // iOS 16 WebKit and current Android WebView.
    target: ['safari16', 'chrome120'],
    modulePreload: { polyfill: false },
    rollupOptions: { input: { index: resolve('src/mobile/index.html') } },
  },
})
