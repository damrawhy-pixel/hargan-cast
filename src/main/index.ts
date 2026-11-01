import { app, BrowserWindow, ipcMain, net, powerSaveBlocker, protocol, shell } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import PlayStationService from './playstation/service'
import SettingsStore, { readBootSettings } from './settings'
import XboxService from './xbox/service'

// file:// has an opaque origin, which blocks module workers and audio worklets.
// The renderer gets a real secure origin of its own instead.
const APP_SCHEME = 'hargan'
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' blob:; connect-src 'self' ws://127.0.0.1:* https:"

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

// The ported Xbox layer logs freely; nothing it says may land in a user's log capture.
if (app.isPackaged) console.log = console.warn = console.error = () => {}

// Dual-GPU laptops and desktops must decode on the discrete card.
app.commandLine.appendSwitch('force_high_performance_gpu')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const features = ['PlatformHEVCDecoderSupport', 'D3D11VideoDecoder']
if (readBootSettings().useVulkan) {
  app.commandLine.appendSwitch('use-vulkan')
  features.push('Vulkan', 'VulkanFromANGLE', 'DefaultANGLEVulkan')
}
app.commandLine.appendSwitch('enable-features', features.join(','))

// Sign-in pages get a plain Chromium identity.
app.userAgentFallback = app.userAgentFallback.replace(/\s*(Electron|hargan-cast|Hargan Cast)\/\S+/g, '')

let win: BrowserWindow | undefined
let xbox: XboxService
let ps: PlayStationService
let settings: SettingsStore
let sleepBlocker: number | undefined
let streaming = false

const send = (channel: string, payload: unknown) => win?.webContents.send(channel, payload)

const BASE_FONT_PX = 15

function applyWindowSettings() {
  const current = settings.get()
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

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) {
      win?.setFullScreen(!win.isFullScreen())
      e.preventDefault()
    }
  })

  win.loadURL(process.env.ELECTRON_RENDERER_URL ?? `${APP_SCHEME}://app/index.html`)
}

function serveRenderer() {
  const root = path.join(__dirname, '../renderer')
  protocol.handle(APP_SCHEME, async (request) => {
    const file = path.normalize(path.join(root, decodeURIComponent(new URL(request.url).pathname)))
    if (!file.startsWith(root)) return new Response(null, { status: 403 })
    const response = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    return new Response(response.body, { status: response.status, headers })
  })
}

function registerIpc() {
  ipcMain.on('app:fullscreen', (_e, on: boolean) => win?.setFullScreen(on))
  ipcMain.on('app:streaming', (_e, on: boolean) => {
    streaming = on
    applyWindowSettings()
    if (on && sleepBlocker === undefined) sleepBlocker = powerSaveBlocker.start('prevent-display-sleep')
    if (!on && sleepBlocker !== undefined) {
      powerSaveBlocker.stop(sleepBlocker)
      sleepBlocker = undefined
    }
  })
  ipcMain.on('app:toggleFullscreen', () => win?.setFullScreen(!win.isFullScreen()))
  ipcMain.on('app:licenses', () => {
    const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
    void shell.openPath(path.join(base, 'NOTICE.md'))
  })
  ipcMain.on('app:external', (_e, url: string) => {
    if (url.startsWith('https://')) shell.openExternal(url)
  })

  const routes: Record<string, (...args: any[]) => unknown> = {
    'xbox:status': () => xbox.status(),
    'xbox:signIn': () => xbox.signIn(),
    'xbox:signOut': () => xbox.signOut(),
    'xbox:titles': () => xbox.titles(),
    'xbox:library': () => xbox.library(),
    'xbox:details': (productId) => xbox.details(productId),
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
      applyWindowSettings()
      return next
    },
    'settings:reset': () => {
      const next = settings.reset()
      xbox.applySettings(next)
      applyWindowSettings()
      return next
    },
    'ps:catalog': (force) => ps.catalog(force),
    'ps:datacenters': (service) => ps.datacenters(service),
    'ps:stream': (game, opts) => ps.stream(game, opts),
    'ps:stop': () => ps.stop(),
    'ps:testHaptics': () => ps.testHaptics(),
    'ps:routeSpeaker': () => ps.routeSpeaker(),
  }
  for (const [channel, handler] of Object.entries(routes)) ipcMain.handle(channel, (_e, ...args) => handler(...args))
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

  settings = new SettingsStore()
  xbox = new XboxService((s) => send('xbox:statusChanged', s), settings.get())
  ps = new PlayStationService(
    (s) => send('ps:statusChanged', s),
    (e) => send('ps:event', e),
    () => settings.get(),
  )
  registerIpc()
  createWindow()
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
