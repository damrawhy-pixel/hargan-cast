// The few Electron pieces the shared Xbox layer touches, for the phone and tablet apps.
//
// On the desktop the sign-in page runs in a window whose responses are watched for
// the redirect to ms-xal-…://auth. Here the page opens in the system browser sheet;
// the OS hands that redirect back to the app (registered as a URL scheme), and it is
// delivered to the same response listener the desktop code registers.
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'

type HeadersListener = (details: { url: string; responseHeaders: Record<string, string[]> }, callback: (r: unknown) => void) => void

const headerListeners: HeadersListener[] = []
let closeListeners: (() => void)[] = []
let signingIn = false

void App.addListener('appUrlOpen', ({ url }) => {
  if (!url.startsWith('ms-xal-')) return
  signingIn = false
  for (const listener of headerListeners) listener({ url, responseHeaders: { Location: [url] } }, () => {})
})

void Browser.addListener('browserFinished', () => {
  // The sheet was closed by hand, not by a completed sign-in.
  if (!signingIn) return
  signingIn = false
  const listeners = closeListeners
  closeListeners = []
  listeners.forEach((l) => l())
})

export const app = {
  getLocale: () => navigator.language || 'en-US',
  getPath: () => '',
  isPackaged: true,
}

export const session = {
  fromPartition: () => ({
    webRequest: {
      onHeadersReceived: (_filter: unknown, listener: HeadersListener) => {
        headerListeners.push(listener)
      },
    },
    clearStorageData: async () => {},
  }),
}

export class BrowserWindow {
  constructor(_options?: unknown) {}

  loadURL(url: string) {
    signingIn = true
    closeListeners = []
    void Browser.open({ url, presentationStyle: 'popover' })
  }

  on(event: string, listener: () => void) {
    if (event === 'close' || event === 'closed') closeListeners.push(listener)
  }

  close() {
    closeListeners = []
    void Browser.close().catch(() => {})
  }
}

export const dialog = { showMessageBox: async () => ({}) }
export const safeStorage = { isEncryptionAvailable: () => false }
export default { app, session, BrowserWindow, dialog, safeStorage }
