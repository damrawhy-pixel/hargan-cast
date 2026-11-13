// window.hc for the phone and tablet apps. The desktop gets the same contract
// from Electron's preload; here it is built from Capacitor plugins.
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { ScreenOrientation } from '@capacitor/screen-orientation'
import { StatusBar } from '@capacitor/status-bar'
import XboxService from '../main/xbox/service'
import type { AppSettings } from '../shared/settings'
import type { HarganApi, PsEvent, PsStatus, XboxStatus } from '../shared/types'
import MobilePlayStation, { PsCore } from './playstation'
import { getSettings, resetSettings, setSettings } from './settings'
import { loadVaults } from './shims/secureStore'

const SOURCE_URL = 'https://github.com/damrawhy-pixel/hargan-cast'

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
const psEvents = channel<PsEvent>()

async function fullscreen(on: boolean) {
  await (on ? StatusBar.hide() : StatusBar.show()).catch(() => {})
}

// Playing with a pad means nobody touches the screen: keep it on, and keep Wi-Fi awake.
// Games are wide, so a stream holds the screen sideways (either way round) until it ends.
function streaming(on: boolean) {
  void fullscreen(on)
  void PsCore.streaming({ on }).catch(() => {})
  void (on ? ScreenOrientation.lock({ orientation: 'landscape' }) : ScreenOrientation.unlock()).catch(() => {})
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

// The Xbox player's way out to native code (its "Native" vibration mode). Only
// rumble is wired; Apple and Android give apps no trigger motors to drive.
function installXboxRumble() {
  ;(window as unknown as { XStreaming: unknown }).XStreaming = {
    send: async (_channel: string, name: string, data: { low?: number; high?: number; durationMs?: number }) => {
      if (name !== 'triggerNativeGamepadTestRumble') return
      // The player calls the strong (left) motor "high" and the light (right) one "low".
      await PsCore.rumble({ left: data.high ?? 0, right: data.low ?? 0, durationMs: data.durationMs ?? 0 })
    },
  }
}

export async function installBridge() {
  document.documentElement.dataset.platform = 'mobile'
  installXboxRumble()
  void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
  void App.addListener('backButton', handleBack)

  // Account sessions come out of the platform key store before any service reads them.
  await loadVaults()

  // The same Xbox service the desktop runs, on the browser stand-ins in ./shims.
  let current = await getSettings()
  const xbox = new XboxService(xboxStatus.emit, current)
  const ps = new MobilePlayStation(psStatus.emit, psEvents.emit, () => current)
  const applied = (settings: AppSettings) => {
    current = settings
    xbox.applySettings(settings)
    return settings
  }

  const api: HarganApi = {
    platform: {
      fullscreen: (on) => void fullscreen(on),
      toggleFullscreen: () => void StatusBar.getInfo().then((info) => fullscreen(info.visible)).catch(() => {}),
      streaming,
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
      status: async () => ps.status(),
      signIn: async () => ps.signIn(),
      signInWithToken: async (token) => ps.signInWithToken(token),
      signOut: () => ps.signOut(),
      catalog: (force) => ps.catalog(force),
      datacenters: async (service) => ps.datacenters(service),
      stream: (game, opts) => ps.stream(game, opts),
      stop: () => ps.stop(),
      // The desktop drives a DualSense itself; on a phone the OS owns the controller.
      testHaptics: async () => false,
      routeSpeaker: async () => false,
      info: (game) => ps.info(game),
      onStatus: psStatus.on,
      onEvent: psEvents.on,
    },
  }
  window.hc = api
}
