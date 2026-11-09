// window.hc for the phone and tablet apps. The desktop gets the same contract
// from Electron's preload; here it is built from Capacitor plugins.
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { StatusBar } from '@capacitor/status-bar'
import XboxService from '../main/xbox/service'
import type { AppSettings } from '../shared/settings'
import type { HarganApi, PsStatus, XboxStatus } from '../shared/types'
import { getSettings, resetSettings, setSettings } from './settings'

const SOURCE_URL = 'https://github.com/damrawhy-pixel/hargan-cast'
const NOT_YET = 'Bu hesap mobil sürümde henüz bağlanamıyor. Bir sonraki sürümde gelecek.'

// Listeners for status changes the services report on their own.
function channel<T>() {
  const listeners = new Set<(value: T) => void>()
  return {
    emit: (value: T) => listeners.forEach((l) => l(value)),
    on: (cb: (value: T) => void) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}

const xboxStatus = channel<XboxStatus>()
const psStatus = channel<PsStatus>()
let ps: PsStatus = { state: 'signedOut' }

const unsupported = () => Promise.reject(new Error(NOT_YET))

async function fullscreen(on: boolean) {
  await (on ? StatusBar.hide() : StatusBar.show()).catch(() => {})
}

// The hardware back button behaves like B on a pad: close what is open, then leave.
function handleBack() {
  const close = document.querySelector<HTMLElement>('.viewer .detail-back, .detail .detail-back')
  if (close) return close.click()
  if (document.querySelector('.stream')) return window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }))
  const home = document.querySelector<HTMLElement>('[data-tab="home"]')
  if (home && home.getAttribute('aria-selected') !== 'true') return home.click()
  void App.minimizeApp()
}

export async function installBridge() {
  document.documentElement.dataset.platform = 'mobile'
  void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
  void App.addListener('backButton', handleBack)

  // The same Xbox service the desktop runs, on the browser stand-ins in ./shims.
  const xbox = new XboxService(xboxStatus.emit, await getSettings())
  const applied = (settings: AppSettings) => {
    xbox.applySettings(settings)
    return settings
  }

  const api: HarganApi = {
    platform: {
      fullscreen: (on) => void fullscreen(on),
      toggleFullscreen: () => void StatusBar.getInfo().then((info) => fullscreen(info.visible)).catch(() => {}),
      streaming: (on) => void fullscreen(on),
      openExternal: (url) => void Browser.open({ url }),
      // The licences ship with the source; on a phone they are read where the source lives.
      openLicenses: () => void Browser.open({ url: `${SOURCE_URL}/blob/main/NOTICE.md` }),
    },
    settings: {
      get: getSettings,
      set: (patch) => setSettings(patch).then(applied),
      reset: () => resetSettings().then(applied),
    },
    xbox: {
      status: async () => xbox.status(),
      signIn: async () => xbox.signIn(),
      signOut: () => xbox.signOut(),
      titles: () => xbox.titles(),
      library: () => xbox.library(),
      info: (productId) => xbox.info(productId),
      startStream: (titleId) => xbox.startStream(titleId),
      activeSessions: () => xbox.activeSessions(),
      adoptSession: async (id, titleId) => xbox.adoptSession(id, titleId),
      endSession: (id, titleId) => xbox.endSession(id, titleId),
      session: async (id) => xbox.session(id),
      stopStream: (id) => xbox.stopStream(id),
      sendSdp: (id, sdp) => xbox.sendSdp(id, sdp) as Promise<{ sdp: string }>,
      sendChatSdp: (id, sdp) => xbox.sendChatSdp(id, sdp) as Promise<{ sdp: string }>,
      sendIce: (id, ice) => xbox.sendIce(id, ice),
      keepalive: async (id) => {
        await xbox.keepalive(id)
      },
      onStatus: xboxStatus.on,
    },
    ps: {
      status: async () => ps,
      signIn: unsupported,
      signInWithToken: unsupported,
      signOut: async () => {
        ps = { state: 'signedOut' }
        psStatus.emit(ps)
      },
      catalog: unsupported,
      datacenters: async () => [],
      stream: unsupported,
      stop: async () => {},
      testHaptics: async () => false,
      routeSpeaker: async () => false,
      info: async () => ({ screenshots: [] }),
      onStatus: psStatus.on,
      onEvent: () => () => {},
    },
  }
  window.hc = api
}
