import { app, BrowserWindow, net, session } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import type { AppSettings } from '../../shared/settings'
import type { GameInfo, PsCatalog, PsDatacenter, PsEvent, PsGame, PsStatus, PsStreamOptions, PsStreamStarted } from '../../shared/types'
import { log, safeUrl } from '../log'
import SecureStore from '../secureStore'
import {
  CATALOG_WARNING,
  DEFAULT_CONTEXT,
  SESSION_EXPIRED,
  SESSION_URL,
  SIGN_IN_PAGE_HOST,
  catalogContext,
  datacentersKey,
  extractNpsso,
  friendlyError,
  parseDatacenters,
  parseStorePage,
  signInUrl,
  storePageHasDetails,
  storePages,
  streamArgs,
  type CatalogContext,
} from './common'
import { HttpBridge } from './httpBridge'

const PARTITION = 'persist:playstation'
const SIGN_IN_POLL_MS = 1500
const CORE_LOG_LINES = 300

interface Pending {
  resolve(value: any): void
  reject(error: Error): void
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
  private context: CatalogContext = DEFAULT_CONTEXT
  private infoCache = new Map<string, GameInfo>()
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

    win.loadURL(signInUrl(crypto.randomUUID())).catch(() => {
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
    this.acceptToken(extractNpsso(input))
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
    this.setStatus({ state: 'signedOut', error: SESSION_EXPIRED })
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
    this.context = catalogContext(catalog)
    const warning = catalog.warning ? CATALOG_WARNING : ''
    return { games: catalog.games ?? [], warning, nativeMode: catalog.nativeMode }
  }

  async stream(game: PsGame, opts: PsStreamOptions): Promise<PsStreamStarted> {
    await this.ensureCore()
    const key = datacentersKey(game.streamServiceType)
    const reply = await this.call(
      'stream',
      streamArgs(game, opts, this.settings(), this.context, {
        npsso: this.npsso(),
        locale: this.vault.get('locale', 'en-US'),
        attrPassed: this.vault.get('attrPassed', false),
        priorDatacenters: this.vault.get(key, '[]'),
      }),
    )
    this.vault.set('attrPassed', true)
    if (reply.datacenters) this.vault.set(key, reply.datacenters)
    return {
      url: `ws://127.0.0.1:${this.media!.port}/${this.media!.token}`,
      codec: reply.codec,
      width: reply.width,
      height: reply.height,
    }
  }

  datacenters(service: 'pscloud' | 'psnow'): PsDatacenter[] {
    return parseDatacenters(this.vault.get(datacentersKey(service), '[]'))
  }

  async info(game: PsGame): Promise<GameInfo> {
    const cached = this.infoCache.get(game.productId)
    if (cached) return cached
    const { locale, pages } = storePages(game, this.context)
    let html = ''
    for (const page of pages) {
      const res = await net.fetch(page, { headers: { 'Accept-Language': locale } }).catch(() => undefined)
      if (res?.ok) {
        html = await res.text()
        if (storePageHasDetails(html)) break
      }
    }
    const info = parseStorePage(html)
    this.infoCache.set(game.productId, info)
    return info
  }

  async testHaptics(): Promise<boolean> {
    await this.ensureCore()
    const { played } = await this.call('hapticTest', { strength: this.settings().psHapticStrength })
    return played
  }

  async routeSpeaker(): Promise<boolean> {
    await this.ensureCore()
    const { routed } = await this.call('speakerRoute', {})
    return routed
  }

  async stop() {
    this.core?.stdin.write(`${JSON.stringify({ cmd: 'stop' })}\n`)
  }

  shutdown() {
    this.core?.stdin.end()
  }
}
