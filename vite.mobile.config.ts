import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const shim = (name: string) => resolve(`src/mobile/shims/${name}.ts`)

// The Xbox layer in src/main is shared with the desktop. Its Node and Electron
// imports are pointed at browser versions here, so that code runs unchanged.
const nodeShims: Record<string, string> = {
  electron: shim('electron'),
  crypto: shim('crypto'),
  'node:crypto': shim('crypto'),
  https: shim('https'),
  'node:https': shim('https'),
  http: shim('https'),
  fs: shim('empty'),
  'node:fs': shim('empty'),
  jose: shim('jose'),
}

// Desktop-only modules reached through relative imports.
const fileShims: Record<string, string> = {
  [resolve('src/main/secureStore.ts')]: shim('secureStore'),
  [resolve('src/main/log.ts')]: shim('log'),
}

function desktopModules(): Plugin {
  return {
    name: 'hargan-mobile-shims',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (nodeShims[source]) return nodeShims[source]
      if (!source.startsWith('.') || !importer) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return resolved && fileShims[resolve(resolved.id)] ? fileShims[resolve(resolved.id)] : null
    },
  }
}

// Builds the interface for the phone and tablet apps. Same renderer as the desktop,
// started through src/mobile, which provides window.hc without Electron.
export default defineConfig({
  root: 'src/mobile',
  base: './',
  publicDir: resolve('src/renderer/public'),
  plugins: [desktopModules(), react()],
  // The ported Xbox code tags its log lines with these.
  define: { __filename: JSON.stringify('xbox'), __dirname: JSON.stringify('') },
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    // The ported token classes redeclare `data`, set by their base constructor.
    tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
  },
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
