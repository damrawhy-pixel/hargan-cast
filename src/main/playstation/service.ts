import { app, BrowserWindow, session } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import type { AppSettings } from '../../shared/settings'
import type { PsCatalog, PsDatacenter, PsEvent, PsGame, PsStatus, PsStreamOptions, PsStreamStarted } from '../../shared/types'
import { log, safeUrl } from '../log'
import SecureStore from '../secureStore'
import { HttpBridge } from './httpBridge'

const PARTITION = 'persist:playstation'
const SIGN_IN_URL = 'https://ca.account.sony.com/api/authz/v3/oauth/authorize'
const SIGN_IN_PARAMS = {
  client_id: 'ba495a24-818c-472b-b12d-ff231c1b5745',
  redirect_uri: 'https://remoteplay.dl.playstation.net/remoteplay/redirect',
  scope: 'psn:clientapp referenceDataService:countryConfig.read pushNotification:webSocket.desktop.connect sessionManager:remotePlaySession.system.update',
  response_type: 'code',
  service_entity: 'urn:service-entity:psn',
  access_type: 'offline',
  smcid: 'remoteplay',
  layout_type: 'popup',
  PlatformPrivacyWs1: 'minimal',
  no_captcha: 'true',
}
const SIGN_IN_PAGE_HOST = 'my.account.sony.com'
const SESSION_URL = 'https://ca.account.sony.com/api/v1/ssocookie'
const SIGN_IN_POLL_MS = 1500
const CORE_LOG_LINES = 300
const NPSSO_PATTERN = /[A-Za-z0-9]{40,128}/

interface Pending {
  resolve(value: any): void
  reject(error: Error): void
}

interface CatalogContext {
  country: string
  lang: string
  foreign: boolean
}

export default class PlayStationService {
  private vault = new SecureStore('playstation')
  private http = new HttpBridge()
  private core?: ChildProcessWithoutNullStreams
  private media?: { port: number; token: string }
  private ready?: Promise<void>
  private pending = new Map<number, Pending>()
  private nextId = 1
  private coreLog: string[] = []
  private context: CatalogContext = { country: 'US', lang: 'en', foreign: false }
  private signInWindow?: BrowserWindow
  private _status: PsStatus

  constructor(
    private notify: (status: PsStatus) => void,
    private push: (event: PsEvent) => void,
    private settings: () => AppSettings,
  ) {
    this._status = { state: this.npsso() ? 'signedIn' : 'signedOut' }
  }

  private npsso() {
    return this.vault.get<string>('npsso', '')
  }

  private setStatus(status: PsStatus) {
    this._status = status
    this.notify(status)
  }

  status() {
    return this._status
  }

  // --- account -------------------------------------------------------------

  signIn() {
    if (this.signInWindow) {
      this.signInWindow.focus()
      return
    }
    const partition = session.fromPartition(PARTITION)
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      title: 'PlayStation hesabı',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { partition: PARTITION, sandbox: true },
    })
    this.signInWindow = win
    this.setStatus({ state: 'signingIn' })

    const capture = async () => {
      const [cookie] = await partition.cookies.get({ name: 'npsso' })
      if (cookie?.value) {
        log('ps sign-in: session captured from cookie')
        this.acceptToken(cookie.value)
      }
    }
    // Once Sony has left its sign-in page the session exists even if the cookie
    // is not visible to us yet, and Sony will hand it over from this endpoint.
    const askSony = async (url: string) => {
      if (win.isDestroyed() || new URL(url).host === SIGN_IN_PAGE_HOST) return
      const response = await partition.fetch(SESSION_URL, { credentials: 'include' }).catch(() => undefined)
      log(`ps sign-in: session endpoint answered ${response?.status ?? 'nothing'}`)
      const token = response?.ok ? (await response.json().catch(() => undefined))?.npsso : undefined
      if (typeof token === 'string' && token.length > 0) this.acceptToken(token)
    }
    const onNavigate = (_e: unknown, url: string) => {
      log(`ps sign-in: ${safeUrl(url)}`)
      void capture().then(() => askSony(url).catch(() => {}))
    }
    const onCookie = (_e: unknown, cookie: Electron.Cookie, _cause: string, removed: boolean) => {
      if (cookie.name === 'npsso' && !removed) this.acceptToken(cookie.value)
    }
    partition.cookies.on('changed', onCookie)
    win.webContents.on('did-navigate', onNavigate)
    win.webContents.on('did-navigate-in-page', onNavigate)
    win.webContents.on('did-redirect-navigation', (_e, url) => onNavigate(_e, url))
    win.webContents.on('did-fail-load', (_e, code, description, url) => log(`ps sign-in failed load ${code} ${description} ${safeUrl(url)}`))
    const poll = setInterval(() => void capture(), SIGN_IN_POLL_MS)

    win.on('closed', () => {
      clearInterval(poll)
      partition.cookies.off('changed', onCookie)
      this.signInWindow = undefined
      if (this._status.state === 'signingIn') this.setStatus({ state: 'signedOut' })
    })

    const url = new URL(SIGN_IN_URL)
    for (const [k, v] of Object.entries(SIGN_IN_PARAMS)) url.searchParams.set(k, v)
    url.searchParams.set('cid', crypto.randomUUID())
    win.loadURL(url.toString()).catch(() => {
      this.setStatus({ state: 'signedOut', error: 'Sony giriş sayfasına ulaşılamadı. Ağ bağlantını kontrol et.' })
      win.destroy()
    })
  }

  private acceptToken(token: string) {
    this.vault.set('npsso', token)
    this.setStatus({ state: 'signedIn' })
    this.signInWindow?.destroy()
  }

  // Sony sometimes refuses embedded logins; the token page in a normal browser
  // is the documented way out. Accepts the raw value or the page's JSON.
  signInWithToken(input: string) {
    const match = input.match(NPSSO_PATTERN)
    if (!match) throw new Error('Bu bir NPSSO değerine benzemiyor')
    this.acceptToken(match[0])
  }

  async signOut() {
    this.vault.clear()
    await session.fromPartition(PARTITION).clearStorageData()
    fs.rmSync(this.cacheDir(), { recursive: true, force: true })
    this.setStatus({ state: 'signedOut' })
  }

  // --- sidecar -------------------------------------------------------------

  private corePath() {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'hargan-ps-core.exe')
      : path.join(app.getAppPath(), 'native', 'bin', 'hargan-ps-core.exe')
  }

  private ensureCore() {
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      const core = spawn(this.corePath(), [], { windowsHide: true })
      this.core = core

      core.on('error', (e) => {
        this.ready = undefined
        reject(new Error(`PlayStation çekirdeği başlatılamadı: ${e.message}`))
      })
      core.on('exit', () => {
        this.core = undefined
        this.media = undefined
        this.ready = undefined
        const orphaned = [...this.pending.values()]
        this.pending.clear()
        orphaned.forEach((p) => p.reject(new Error('PlayStation çekirdeği beklenmedik şekilde kapandı')))
      })

      readline.createInterface({ input: core.stderr }).on('line', (line) => {
        this.coreLog.push(line)
        if (this.coreLog.length > CORE_LOG_LINES) this.coreLog.shift()
      })
      readline.createInterface({ input: core.stdout, crlfDelay: Infinity }).on('line', (line) => {
        const msg = JSON.parse(line)
        if (msg.ev === 'hello') {
          this.media = { port: msg.port, token: msg.token }
          resolve()
        } else if (msg.ev === 'http') {
          this.http.perform(msg).then((reply) => core.stdin.write(`${JSON.stringify({ cmd: 'httpReply', ...reply })}\n`))
        } else if (msg.ev) this.push(msg)
        else {
          const waiter = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          if (msg.ok) waiter?.resolve(msg)
          else {
            if (msg.error === 'AUTHORIZATION_FAILED') this.expire()
            waiter?.reject(new Error(friendlyError(msg.error)))
          }
        }
      })
    })
    return this.ready
  }

  private expire() {
    this.vault.delete('npsso')
    this.setStatus({ state: 'signedOut', error: 'PlayStation oturumunun süresi doldu. Tekrar giriş yap.' })
  }

  private call(cmd: string, args: Record<string, unknown>) {
    const id = this.nextId++
    return new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.core!.stdin.write(`${JSON.stringify({ id, cmd, ...args })}\n`)
    })
  }

  // --- catalog and streaming -----------------------------------------------

  private cacheDir() {
    return path.join(app.getPath('userData'), 'ps-catalog')
  }

  async catalog(force: boolean): Promise<PsCatalog> {
    await this.ensureCore()
    fs.mkdirSync(this.cacheDir(), { recursive: true })
    const { catalog } = await this.call('catalog', {
      npsso: this.npsso(),
      locale: this.vault.get('locale', app.getLocale().includes('-') ? app.getLocale() : 'en-US'),
      cacheDir: this.cacheDir(),
      force,
    })

    // The lib settles region and language; streaming must reuse them verbatim.
    if (catalog.settledLocale) this.vault.set('locale', catalog.settledLocale)
    const [lang = 'en', country = 'US'] = String(catalog.settledLocale || 'en-US').split('-')
    this.context = {
      country: (catalog.fallbackRegion || country).toUpperCase(),
      lang: (catalog.resolvedStoreLang || lang).toLowerCase(),
      foreign: !catalog.nativeMode,
    }
    const warning = catalog.warning ? 'Oturumun süresi doldu. Sahip olduğun oyunları görmek için tekrar giriş yap.' : ''
    return { games: catalog.games ?? [], warning, nativeMode: catalog.nativeMode }
  }

  async stream(game: PsGame, opts: PsStreamOptions): Promise<PsStreamStarted> {
    await this.ensureCore()
    const datacentersKey = `datacenters.${game.streamServiceType}`
    const owned = game.isOwned && game.streamServiceType === 'psnow'
    const settings = this.settings()
    const cloud = game.streamServiceType === 'pscloud'
    const reply = await this.call('stream', {
      service: game.streamServiceType,
      game: game.streamIdentifier,
      npsso: this.npsso(),
      country: this.context.country,
      lang: this.context.lang,
      gameLang: settings.psGameLanguage || this.vault.get('locale', 'en-US'),
      ownedEntitlement: owned ? game.entitlementId ?? '' : '',
      ownedPlatform: owned ? game.platform : '',
      foreign: this.context.foreign,
      attrPassed: this.vault.get('attrPassed', false),
      datacenter: cloud ? settings.psCloudDatacenter : settings.psNowDatacenter,
      priorDatacenters: this.vault.get(datacentersKey, '[]'),
      hevc: opts.hevc,
      resolution: cloud ? settings.psCloudResolution : settings.psNowResolution,
      bitrate: cloud ? settings.psCloudBitrate : settings.psNowBitrate,
      packetLossMax: settings.psPacketLossMax,
      psChord: settings.psOptionsShareForPs,
      nativeDualSense: settings.psNativeDualSense,
      hapticStrength: settings.psHapticStrength,
      triggers: settings.psTriggers,
      vibration: settings.psVibration,
    })
    this.vault.set('attrPassed', true)
    if (reply.datacenters) this.vault.set(datacentersKey, reply.datacenters)
    return {
      url: `ws://127.0.0.1:${this.media!.port}/${this.media!.token}`,
      codec: reply.codec,
      width: reply.width,
      height: reply.height,
    }
  }

  // Filled in by previous streams, which is when the servers get pinged.
  datacenters(service: 'pscloud' | 'psnow'): PsDatacenter[] {
    let list: { dataCenter?: string; rtt?: number }[] = []
    try {
      list = JSON.parse(this.vault.get(`datacenters.${service}`, '[]'))
    } catch {
      return []
    }
    return list
      .filter((d) => d.dataCenter)
      .map((d) => ({ name: d.dataCenter!, rttMs: d.rtt }))
      .sort((a, b) => (a.rttMs ?? Infinity) - (b.rttMs ?? Infinity))
  }

  async testHaptics(): Promise<boolean> {
    await this.ensureCore()
    const { played } = await this.call('hapticTest', { strength: this.settings().psHapticStrength })
    return played
  }

  async stop() {
    this.core?.stdin.write(`${JSON.stringify({ cmd: 'stop' })}\n`)
  }

  shutdown() {
    this.core?.stdin.end()
  }
}

function friendlyError(message: string) {
  if (message === 'AUTHORIZATION_FAILED') return 'PlayStation oturumunun süresi doldu. Tekrar giriş yap.'
  if (message === 'PS_PLUS_SUBSCRIPTION_REQUIRED') return 'Bu oyun için PS Plus Premium aboneliği gerekiyor.'
  if (message === 'PING_TIMEOUT') return 'Veri merkezlerine ulaşılamadı. Bağlantını kontrol edip tekrar dene.'
  if (message === 'ACCOUNT_PRIVACY_SETTINGS') return 'Hesabının gizlilik ayarları bu oyuna izin vermiyor.'
  if (message.startsWith('Selected datacenter')) return 'Seçtiğin veri merkezi şu an kullanılamıyor. Ayarlardan başka birini seç.'
  if (message.startsWith('Timed out waiting')) return 'Akış sunucusu beklenirken süre doldu. Tekrar dene.'
  if (message.startsWith("Couldn't reach") || message.startsWith('Network error')) return 'PlayStation sunucularına ulaşılamadı. Bağlantını kontrol edip tekrar dene.'
  if (message.startsWith('Failed to fetch')) return 'PlayStation kataloğu alınamadı. Tekrar dene.'
  // What Sony sends back is a raw response body, not a sentence.
  if (message.startsWith('{')) return 'PlayStation isteği reddetti. Biraz sonra tekrar dene.'
  return message
}
