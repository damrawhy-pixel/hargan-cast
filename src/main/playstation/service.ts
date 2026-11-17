import { app, BrowserWindow, net, session } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { settingsFor, type AppSettings } from '../../shared/settings'
import type { GameInfo, PsCatalog, PsConsole, PsDatacenter, PsEvent, PsFoundConsole, PsGame, PsStatus, PsStreamOptions, PsStreamStarted } from '../../shared/types'
import { t } from '../../shared/i18n'
import { log, safeUrl } from '../log'
import SecureStore from '../secureStore'
import {
  accountIdBase64,
  catalogWarning,
  DEFAULT_CONTEXT,
  REMOTE_PLAY_CLIENT,
  remoteStreamArgs,
  validAccountId,
  sessionExpired,
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
const CORE_LOG_ON_EXIT = 20
const CORE_HELLO_MS = 15_000
const CATALOG_TIMEOUT_MS = 180_000
const QUICK_TIMEOUT_MS = 20_000
const CONSOLE_TIMEOUT_MS = 30_000
const SONY_AUTHORIZE = 'https://ca.account.sony.com/api/authz/v3/oauth/authorize'
const SONY_TOKEN = 'https://ca.account.sony.com/api/authz/v3/oauth/token'
const SONY_ACCOUNT = 'https://dms.api.playstation.com/api/v1/devices/accounts/me'

/** A linked console with the keys the core needs; only the main process sees these. */
interface StoredConsole extends PsConsole {
  registKey: string
  rpKey: string
}

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
      title: t('PlayStation hesabı'),
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
      this.setStatus({ state: 'signedOut', error: t('Sony giriş sayfasına ulaşılamadı. Ağ bağlantını kontrol et.') })
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
      // A crash leaves a small minidump next to the app's own (see crash_dump.c).
      const core = spawn(this.corePath(), [], { windowsHide: true, env: { ...process.env, HC_DUMP_DIR: app.getPath('crashDumps') } })
      this.core = core
      const helloTimer = setTimeout(() => {
        log('ps core: no hello in time')
        core.kill()
      }, CORE_HELLO_MS)

      core.on('error', (e) => {
        clearTimeout(helloTimer)
        if (this.core === core) this.ready = undefined
        reject(new Error(t('PlayStation çekirdeği başlatılamadı: {reason}', { reason: e.message })))
      })
      // A core that dies while a line is being written must not take the app with it.
      core.stdin.on('error', (e) => log(`ps core stdin: ${e.message}`))
      core.on('exit', (code, signal) => {
        clearTimeout(helloTimer)
        log(`ps core exited (code ${code ?? '-'}, signal ${signal ?? '-'})`)
        for (const line of this.coreLog.slice(-CORE_LOG_ON_EXIT)) log(`ps core: ${line}`)
        // Rejecting is a no-op once hello has resolved it; before that it ends the wait.
        reject(new Error(t('PlayStation çekirdeği beklenmedik şekilde kapandı')))
        if (this.core !== core) return
        this.core = undefined
        this.media = undefined
        this.ready = undefined
        const orphaned = [...this.pending.values()]
        this.pending.clear()
        orphaned.forEach((p) => p.reject(new Error(t('PlayStation çekirdeği beklenmedik şekilde kapandı'))))
      })

      readline.createInterface({ input: core.stderr }).on('line', (line) => {
        this.coreLog.push(line)
        if (this.coreLog.length > CORE_LOG_LINES) this.coreLog.shift()
      })
      readline.createInterface({ input: core.stdout, crlfDelay: Infinity }).on('line', (line) => {
        let msg: any
        try {
          msg = JSON.parse(line)
        } catch {
          // Something in the core printed to stdout; keep it with the core's own log.
          this.coreLog.push(`[stdout] ${line.slice(0, 200)}`)
          return
        }
        if (msg.ev === 'hello') {
          clearTimeout(helloTimer)
          this.media = { port: msg.port, token: msg.token }
          resolve()
        } else if (msg.ev === 'http') {
          this.http
            .perform(msg)
            .catch((e: Error) => ({ rid: msg.rid, status: 0, error: e.message }))
            .then((reply) => this.write(core, { cmd: 'httpReply', ...reply }))
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
    this.setStatus({ state: 'signedOut', error: sessionExpired() })
  }

  private write(core: ChildProcessWithoutNullStreams, message: Record<string, unknown>) {
    if (core.stdin.writable) core.stdin.write(`${JSON.stringify(message)}\n`)
  }

  /** Sends a command and waits for its reply; `timeoutMs` 0 waits as long as the core lives. */
  private call(cmd: string, args: Record<string, unknown>, timeoutMs = 0) {
    const core = this.core
    if (!core) return Promise.reject(new Error(t('PlayStation çekirdeği çalışmıyor. Tekrar dene.')))
    const id = this.nextId++
    return new Promise<any>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              if (!this.pending.delete(id)) return
              log(`ps core: ${cmd} timed out`)
              reject(new Error(t('PlayStation çekirdeği yanıt vermedi. Tekrar dene.')))
            }, timeoutMs)
          : undefined
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.write(core, { id, cmd, ...args })
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
    }, CATALOG_TIMEOUT_MS)

    // The lib settles region and language; streaming must reuse them verbatim.
    if (catalog.settledLocale) this.vault.set('locale', catalog.settledLocale)
    this.context = catalogContext(catalog)
    const warning = catalog.warning ? catalogWarning() : ''
    return { games: catalog.games ?? [], warning, nativeMode: catalog.nativeMode }
  }

  async stream(game: PsGame, opts: PsStreamOptions): Promise<PsStreamStarted> {
    await this.ensureCore()
    const key = datacentersKey(game.streamServiceType)
    const reply = await this.call(
      'stream',
      streamArgs(game, opts, settingsFor(this.settings(), `ps:${game.productId}`), this.context, {
        npsso: this.npsso(),
        locale: this.vault.get('locale', 'en-US'),
        attrPassed: this.vault.get('attrPassed', false),
        priorDatacenters: this.vault.get(key, '[]'),
      }),
    )
    this.vault.set('attrPassed', true)
    if (reply.datacenters) this.vault.set(key, reply.datacenters)
    const media = this.media
    if (!media) throw new Error(t('PlayStation çekirdeği beklenmedik şekilde kapandı'))
    return {
      url: `ws://127.0.0.1:${media.port}/${media.token}`,
      codec: reply.codec,
      width: reply.width,
      height: reply.height,
      rttMs: reply.rttMs || undefined,
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
    const { played } = await this.call('hapticTest', { strength: this.settings().psHapticStrength }, QUICK_TIMEOUT_MS)
    return played
  }

  async routeSpeaker(): Promise<boolean> {
    await this.ensureCore()
    const { routed } = await this.call('speakerRoute', {}, QUICK_TIMEOUT_MS)
    return routed
  }

  /** Fits the monitor's refresh rate to a stream for its duration; see display.c. */
  async matchDisplay(hwnd: string, fps: number): Promise<{ changed: boolean; from: number; to: number }> {
    await this.ensureCore()
    return this.call('display', { action: 'match', hwnd, fps }, QUICK_TIMEOUT_MS)
  }

  async restoreDisplay() {
    if (this.core) await this.call('display', { action: 'restore' }, QUICK_TIMEOUT_MS).catch(() => undefined)
  }

  // --- Remote Play with the user's own console -------------------------------

  private stored(): StoredConsole[] {
    return this.vault.get<StoredConsole[]>('consoles', [])
  }

  consoles(): PsConsole[] {
    return this.stored().map(({ id, name, address, ps5 }) => ({ id, name, address, ps5 }))
  }

  /** Consoles on the local network, or at a typed address (another network, a VPN). */
  async discoverConsoles(host?: string): Promise<PsFoundConsole[]> {
    await this.ensureCore()
    const { consoles } = await this.call('console', { action: 'discover', host: typeof host === 'string' ? host.trim() : '' }, QUICK_TIMEOUT_MS)
    return consoles ?? []
  }

  /**
   * The PSN account id, which a console wants at linking. Sony hands it out to
   * the Remote Play app's own login, which the saved session can do silently.
   */
  private async accountId(): Promise<string> {
    const cached = this.vault.get<string>('accountId', '')
    if (cached) return cached
    const npsso = this.npsso()
    if (!npsso) throw new Error(sessionExpired())
    const ses = session.fromPartition('ps-account')
    try {
      await ses.cookies.set({ url: 'https://ca.account.sony.com', name: 'npsso', value: npsso, secure: true, httpOnly: true })
      const authorize = new URL(SONY_AUTHORIZE)
      for (const [k, v] of Object.entries({ response_type: 'code', client_id: REMOTE_PLAY_CLIENT.id, redirect_uri: REMOTE_PLAY_CLIENT.redirect, scope: REMOTE_PLAY_CLIENT.scope, service_entity: 'urn:service-entity:psn', prompt: 'none' }))
        authorize.searchParams.set(k, v)
      // Sony answers with a redirect to the Remote Play page carrying the code.
      const redirected = await ses.fetch(authorize.toString(), { cache: 'no-store' })
      const code = new URL(redirected.url).searchParams.get('code')
      if (!code) throw new Error('code')
      const basic = Buffer.from(`${REMOTE_PLAY_CLIENT.id}:${REMOTE_PLAY_CLIENT.secret}`).toString('base64')
      const token = await ses.fetch(SONY_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REMOTE_PLAY_CLIENT.redirect, token_format: 'jwt' }).toString(),
      })
      const { access_token: access } = (await token.json()) as { access_token?: string }
      if (!access) throw new Error('token')
      const me = await ses.fetch(SONY_ACCOUNT, { headers: { Authorization: `Bearer ${access}` } })
      const { accountId } = (await me.json()) as { accountId?: string | number }
      if (!accountId) throw new Error('account')
      const id = accountIdBase64(String(accountId))
      this.vault.set('accountId', id)
      return id
    } catch (e) {
      log(`ps account id: ${(e as Error).message}`)
      throw new Error(t('PSN hesap kimliği alınamadı. Gelişmiş bölümünden elle girebilirsin.'))
    } finally {
      void ses.clearStorageData()
    }
  }

  /** Links the app to a console with the PIN it shows; `accountId` overrides the looked-up one. */
  async registerConsole(found: { address: string; ps5: boolean; name?: string; hostId?: string }, pin: string, accountId?: string): Promise<PsConsole> {
    const digits = String(pin).replace(/\D/g, '')
    if (digits.length !== 8) throw new Error(t('PIN 8 haneli olmalı.'))
    if (accountId && !validAccountId(accountId)) throw new Error(t('Bu bir PSN hesap kimliğine benzemiyor.'))
    const account = accountId?.trim() || (await this.accountId())
    await this.ensureCore()
    const { console: linked } = await this.call('console', { action: 'register', host: found.address, ps5: found.ps5, accountId: account, pin: Number(digits) }, CONSOLE_TIMEOUT_MS)
    if (accountId) this.vault.set('accountId', account)
    const entry: StoredConsole = {
      id: found.hostId || linked.mac || crypto.randomUUID(),
      name: linked.name || found.name || (linked.ps5 ? 'PS5' : 'PS4'),
      address: found.address,
      ps5: Boolean(linked.ps5),
      registKey: linked.registKey,
      rpKey: linked.rpKey,
    }
    this.vault.set('consoles', [...this.stored().filter((c) => c.id !== entry.id), entry])
    return { id: entry.id, name: entry.name, address: entry.address, ps5: entry.ps5 }
  }

  forgetConsole(id: string) {
    this.vault.set('consoles', this.stored().filter((c) => c.id !== id))
    return this.consoles()
  }

  /** A console found at a new address (DHCP moved it) keeps its keys. */
  updateConsoleAddress(id: string, address: string) {
    this.vault.set('consoles', this.stored().map((c) => (c.id === id ? { ...c, address } : c)))
  }

  async wakeConsole(id: string) {
    const target = this.stored().find((c) => c.id === id)
    if (!target) throw new Error(t('Konsol bulunamadı.'))
    await this.ensureCore()
    await this.call('console', { action: 'wake', host: target.address, ps5: target.ps5, registKey: target.registKey }, QUICK_TIMEOUT_MS)
  }

  async remoteStream(id: string, opts: PsStreamOptions): Promise<PsStreamStarted> {
    const target = this.stored().find((c) => c.id === id)
    if (!target) throw new Error(t('Konsol bulunamadı.'))
    await this.ensureCore()
    const settings = settingsFor(this.settings(), `console:${id}`)
    const reply = await this.call('remoteStream', { ...remoteStreamArgs(target, opts, settings), registKey: target.registKey, rpKey: target.rpKey })
    const media = this.media
    if (!media) throw new Error(t('PlayStation çekirdeği beklenmedik şekilde kapandı'))
    return { url: `ws://127.0.0.1:${media.port}/${media.token}`, codec: reply.codec, width: reply.width, height: reply.height }
  }

  async stop() {
    if (this.core) this.write(this.core, { cmd: 'stop' })
  }

  shutdown() {
    this.core?.stdin.end()
  }
}
