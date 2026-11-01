import type { HarganApi } from '../../shared/types'

declare global {
  interface Window {
    hc: HarganApi
  }
}

declare module 'xstreaming-player'
