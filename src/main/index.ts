import { app, BrowserWindow, crashReporter, ipcMain, net, powerSaveBlocker, protocol, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { exportDiagnostics } from './diagnostics'
import { networkTest } from './network'
import { log } from './log'
import { resolveLanguage, setLanguage, t } from '../shared/i18n'
import type { AppSettings } from '../shared/settings'
import PlayStationService from './playstation/service'
import SettingsStore, { readBootSettings } from './settings'
import { applyUpdateChannel, startUpdates } from './updates'
import XboxService from './xbox/service'

// file:// has an opaque origin, which blocks module workers and audio worklets.
// The renderer gets a real secure origin of its own instead.
const APP_SCHEME = 'hargan'
// The page itself talks only to the app and to the PlayStation core on loopback;
// every service request goes through this process. Pictures come from the stores'
// image hosts only.
const IMAGE_HOSTS = ['https://*.s-microsoft.com', 'https://*.xboxlive.com', 'https://*.playstation.com', 'https://*.playstation.net']
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${IMAGE_HOSTS.join(' ')}`,
  "media-src 'self' blob:",
  "connect-src 'self' ws://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ')

// What the interface may ask the browser for: the microphone for Xbox party chat,
// pointer and keyboard lock for mouse-and-keyboard games, full screen and the
// audio output picker. Sign-in windows get nothing.
const RENDERER_PERMISSIONS = new Set(['media', 'pointerLock', 'keyboardLock', 'fullscreen', 'speaker-selection'])

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

// The ported Xbox layer logs freely; nothing it says may land in a user's log capture.
if (app.isPackaged) console.log = console.warn = console.error = () => {}

// Crashes of any of the app's processes leave a minidump in the crashDumps folder.
// Nothing is uploaded; the diagnostics file lists them so a user can choose to send one.
crashReporter.start({ uploadToServer: false, compress: true })

// A stray throw in a callback must leave a trace, not a silent half-working app.
process.on('uncaughtException', (e) => log(`main uncaught: ${e.stack ?? e}`))
process.on('unhandledRejection', (reason) => log(`main unhandled rejection: ${(reason as Error)?.stack ?? reason}`))

// Tests run the unpackaged app against a throwaway profile, never the user's
// accounts. A packaged build ignores this.
if (!app.isPackaged && process.env.HC_USER_DATA) app.setPath('userData', process.env.HC_USER_DATA)

const boot = readBootSettings()

// Dual-GPU laptops and desktops must decode on the discrete card.
app.commandLine.appendSwitch('force_high_performance_gpu')
if (boot.ignoreGpuBlocklist) app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
// Chromium drops smooth scrolling when Windows animation effects are off; the
// launcher and rails glide regardless, and the app's own setting governs the rest.
app.commandLine.appendSwitch('enable-smooth-scrolling')
const features = ['PlatformHEVCDecoderSupport', 'D3D11VideoDecoder']
if (boot.useVulkan) {
  app.commandLine.appendSwitch('use-vulkan')
  features.push('Vulkan', 'VulkanFromANGLE', 'DefaultANGLEVulkan')
}
app.commandLine.appendSwitch('enable-features', features.join(','))

// Sign-in pages get a plain Chromium identity.
app.userAgentFallback = app.userAgentFallback.replace(/\s*(Electron|hargan-cast|Hargan ?Cast)\/\S+/gi, '')

// electron-vite's dev server, in development only; an empty value counts as unset.
const DEV_RENDERER_URL = (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) || undefined

let win: BrowserWindow | undefined
let xbox: XboxService
let ps: PlayStationService
let settings: SettingsStore
let sleepBlocker: number | undefined
let rendererRestarts: number[] = []
let gpuCrashes = 0
const RENDERER_RESTART_WINDOW_MS = 5 * 60_000
const MAX_RENDERER_RESTARTS = 3
const GPU_CRASHES_BEFORE_SAFE_MODE = 3
let streaming = false

const send = (channel: string, payload: unknown) => win?.webContents.send(channel, payload)

const BASE_FONT_PX = 15

// Errors and notices from this process are worded in the interface language too.
const applyLanguage = (current: AppSettings) => setLanguage(resolveLanguage(current.language, app.getLocale()))

// Only an installed copy registers itself; a dev or folder build would leave a
// stale entry pointing at a path that moves.
function applyLoginItem(on: boolean) {
  if (!app.isPackaged) return
  if (app.getLoginItemSettings().openAtLogin !== on) app.setLoginItemSettings({ openAtLogin: on })
}

function applyWindowSettings() {
  const current = settings.get()
  applyLanguage(current)
  win?.webContents.setZoomFactor(current.fontSize / BASE_FONT_PX)
  win?.webContents.setBackgroundThrottling(!current.backgroundKeepalive && !streaming)
}

function createWindow() {
  win = new BrowserWindow({
    fullscreen: settings.get().startFullscreen,
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Hargan Cast',
    icon: path.join(__dirname, '../renderer/logo-256.png'),
    backgroundColor: '#05070d',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 60 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
    },
  })

  win.once('ready-to-show', () => win?.show())
  win.webContents.on('did-finish-load', applyWindowSettings)
  win.on('closed', () => (win = undefined))
  win.on('unresponsive', () => log('window unresponsive'))
  win.on('responsive', () => log('window responsive again'))
  // The interface process can die (driver fault, out of memory). Bring it back a
  // few times; after that, leave the crash visible rather than looping.
  win.webContents.on('render-process-gone', (_e, details) => {
    log(`renderer gone: ${details.reason} (exit ${details.exitCode})`)
    if (details.reason === 'clean-exit' || !win) return
    const now = Date.now()
    rendererRestarts = rendererRestarts.filter((t) => now - t < RENDERER_RESTART_WINDOW_MS)
    if (rendererRestarts.length >= MAX_RENDERER_RESTARTS) return log('renderer keeps crashing; not reloading again')
    rendererRestarts.push(now)
    // The page that owned a stream is gone; nothing will stop it otherwise.
    void ps.stop()
    void xbox.stopActive()
    streaming = false
    if (sleepBlocker !== undefined) powerSaveBlocker.stop(sleepBlocker)
    sleepBlocker = undefined
    win.webContents.reload()
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) {
      win?.setFullScreen(!win.isFullScreen())
      e.preventDefault()
    }
  })

  win.loadURL(DEV_RENDERER_URL ?? `${APP_SCHEME}://app/index.html`)
}

function serveRenderer() {
  const root = path.join(__dirname, '../renderer')
  protocol.handle(APP_SCHEME, async (request) => {
    const file = path.normalize(path.join(root, decodeURIComponent(new URL(request.url).pathname)))
    if (!file.startsWith(root + path.sep)) return new Response(null, { status: 403 })
    const response = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    return new Response(response.body, { status: response.status, headers })
  })
}

// Only the app's own page may call into this process; a frame from anywhere else
// (a sign-in page, an injected iframe) is refused and logged.
function trusted(e: IpcMainEvent | IpcMainInvokeEvent) {
  const url = e.senderFrame?.url ?? ''
  const dev = DEV_RENDERER_URL
  const ok = e.sender === win?.webContents && (url.startsWith(`${APP_SCHEME}://app/`) || (dev !== undefined && url.startsWith(dev)))
  if (!ok) log(`ipc refused from ${url.split('?')[0] || 'unknown frame'}`)
  return ok
}

const listen = (channel: string, handler: (...args: any[]) => void) =>
  ipcMain.on(channel, (e, ...args) => {
    if (trusted(e)) handler(...args)
  })

const handle = (channel: string, handler: (...args: any[]) => unknown) =>
  ipcMain.handle(channel, (e, ...args) => {
    if (!trusted(e)) throw new Error('Not allowed')
    return handler(...args)
  })

function registerIpc() {
  listen('app:fullscreen', (on: boolean) => win?.setFullScreen(on === true))
  listen('app:streaming', (on: boolean) => {
    streaming = on
    applyWindowSettings()
    if (on && sleepBlocker === undefined) sleepBlocker = powerSaveBlocker.start('prevent-display-sleep')
    if (!on && sleepBlocker !== undefined) {
      powerSaveBlocker.stop(sleepBlocker)
      sleepBlocker = undefined
    }
  })
  listen('app:toggleFullscreen', () => win?.setFullScreen(!win.isFullScreen()))
  listen('app:licenses', () => {
    const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
    void shell.openPath(path.join(base, 'NOTICE.md'))
  })
  listen('app:external', (url: unknown) => {
    if (typeof url === 'string' && url.startsWith('https://')) void shell.openExternal(url)
  })
  listen('app:log', (text: unknown) => log(String(text).slice(0, 1000)))
  listen('app:error', (text: unknown) => log(`renderer: ${String(text).slice(0, 4000)}`))
  handle('app:diagnostics', () => exportDiagnostics(win, settings.get()))
  handle('app:networkTest', async () => {
    // Sony's stream servers are only known once a stream has measured them; until
    // then its account server stands in for the route to Sony.
    const targets: [string, string][] = [[t('PlayStation hesap sunucusu'), 'https://ca.account.sony.com/']]
    const region = xbox.regionUrl()
    if (region) targets.unshift([t('Xbox bulut bölgesi'), region])
    const report = await networkTest(targets)
    const measured = [...ps.datacenters('pscloud'), ...ps.datacenters('psnow')].filter((d) => d.rttMs !== undefined).slice(0, 3)
    for (const d of measured) report.probes.push({ name: t('PlayStation veri merkezi (son akış)'), host: d.name, rttMs: d.rttMs })
    return report
  })

  const routes: Record<string, (...args: any[]) => unknown> = {
    'xbox:status': () => xbox.status(),
    'xbox:signIn': () => xbox.signIn(),
    'xbox:signOut': () => xbox.signOut(),
    'xbox:titles': () => xbox.titles(),
    'xbox:library': () => xbox.library(),
    'xbox:info': (productId) => xbox.info(productId),
    'xbox:startStream': (id) => xbox.startStream(id),
    'xbox:activeSessions': () => xbox.activeSessions(),
    'xbox:adoptSession': (id, titleId) => xbox.adoptSession(id, titleId),
    'xbox:endSession': (id, titleId) => xbox.endSession(id, titleId),
    'xbox:session': (id) => xbox.session(id),
    'xbox:stopStream': (id) => xbox.stopStream(id),
    'xbox:sendSdp': (id, sdp) => xbox.sendSdp(id, sdp),
    'xbox:sendChatSdp': (id, sdp) => xbox.sendChatSdp(id, sdp),
    'xbox:sendIce': (id, ice) => xbox.sendIce(id, ice),
    'xbox:keepalive': (id) => xbox.keepalive(id),
    'ps:status': () => ps.status(),
    'ps:signIn': () => ps.signIn(),
    'ps:signInWithToken': (token) => ps.signInWithToken(token),
    'ps:signOut': () => ps.signOut(),
    'settings:get': () => settings.get(),
    'settings:set': (patch) => {
      const next = settings.update(patch)
      xbox.applySettings(next)
      applyUpdateChannel(next.betaUpdates)
      applyLoginItem(next.launchAtLogin)
      applyWindowSettings()
      return next
    },
    'settings:reset': () => {
      const next = settings.reset()
      xbox.applySettings(next)
      applyUpdateChannel(next.betaUpdates)
      applyLoginItem(next.launchAtLogin)
      applyWindowSettings()
      return next
    },
    'ps:catalog': (force) => ps.catalog(force),
    'ps:datacenters': (service) => ps.datacenters(service),
    'ps:stream': (game, opts) => ps.stream(game, opts),
    'ps:stop': () => ps.stop(),
    'ps:testHaptics': () => ps.testHaptics(),
    'ps:info': (game) => ps.info(game),
    'ps:routeSpeaker': () => ps.routeSpeaker(),
  }
  for (const [channel, handler] of Object.entries(routes)) handle(channel, handler)
}

// Every web page the app opens, the interface and the sign-in windows alike: no
// pop-ups (an https link goes to the user's browser), no <webview>, no navigation
// off https, and no browser permissions beyond what the interface needs.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (e, url) => {
    if (!url.startsWith('https://')) e.preventDefault()
  })
})

function restrictPermissions() {
  const allow = (contents: Electron.WebContents | null, permission: string) => contents === win?.webContents && RENDERER_PERMISSIONS.has(permission)
  for (const ses of [session.defaultSession, session.fromPartition('persist:xbox'), session.fromPartition('persist:playstation')]) {
    ses.setPermissionRequestHandler((contents, permission, callback) => callback(allow(contents, permission)))
  }
}

app.setAppUserModelId('app.hargan.cast')

// Two copies would fight over the vault files and the controller.
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', () => {
  if (win?.isMinimized()) win.restore()
  win?.focus()
})

app.whenReady().then(() => {
  serveRenderer()
  restrictPermissions()

  settings = new SettingsStore()
  applyLanguage(settings.get())
  xbox = new XboxService((s) => send('xbox:statusChanged', s), settings.get())
  ps = new PlayStationService(
    (s) => send('ps:statusChanged', s),
    (e) => send('ps:event', e),
    () => settings.get(),
  )
  registerIpc()
  createWindow()
  startUpdates(settings.get().betaUpdates)
  applyLoginItem(settings.get().launchAtLogin)
})

// A GPU process that keeps dying usually means a driver that dislikes the
// switches the user opted into; the next start goes without them.
app.on('child-process-gone', (_e, details) => {
  log(`${details.type} process gone: ${details.reason} (exit ${details.exitCode})`)
  if (details.type !== 'GPU' || details.reason === 'clean-exit') return
  const current = settings?.get()
  if (++gpuCrashes < GPU_CRASHES_BEFORE_SAFE_MODE || !current || (!current.useVulkan && !current.ignoreGpuBlocklist)) return
  settings.update({ useVulkan: false, ignoreGpuBlocklist: false })
  log('graphics keeps crashing: Vulkan and the GPU blocklist override are off from the next start')
})

app.on('window-all-closed', () => app.quit())
// Closing mid-stream must not leave a session running on Microsoft's side.
const QUIT_GRACE_MS = 3000
let quitting = false
app.on('before-quit', (e) => {
  ps?.shutdown()
  const pending = xbox?.stopActive()
  if (quitting || !pending) return
  e.preventDefault()
  quitting = true
  void Promise.race([pending, new Promise((r) => setTimeout(r, QUIT_GRACE_MS))]).finally(() => app.quit())
})
