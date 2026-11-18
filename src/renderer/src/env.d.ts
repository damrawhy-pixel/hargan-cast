import type { HarganApi } from '../../shared/types'

declare global {
  /** The app's version, from package.json at build time. */
  const __APP_VERSION__: string

  interface Window {
    hc: HarganApi
  }
}

declare module 'xstreaming-player'
