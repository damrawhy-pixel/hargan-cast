// window.hc.ps on phones and tablets: the desktop's PlayStation service, with the
// native plugin (mobile/plugins/ps-core) in place of the sidecar process, and a web
// view of the plugin's own in place of Electron's sign-in window.
import type { PluginListenerHandle } from '@capacitor/core'
import { PsCore } from './native'
import { t, tryT } from '../shared/i18n'
import {
  catalogWarning,
  DEFAULT_CONTEXT,
  sessionExpired,
  SESSION_URL,
  SIGN_IN_REDIRECT,
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
} from '../main/playstation/common'
import type { AppSettings } from '../shared/settings'
import type { GameInfo, PsCatalog, PsDatacenter, PsEvent, PsGame, PsStatus, PsStreamOptions, PsStreamStarted } from '../shared/types'
import SecureStore from './shims/secureStore'

export { PsCore }

interface Pending {
  resolve(value: any): void
  reject(error: Error): void
}

// The native plugins answer in Turkish; tryT gives the interface language's wording.
const reason = (e: unknown, fallback: string) => (e instanceof Error && e.message ? tryT(e.message) : fallback)

export default class MobilePlayStation {
  private vault = new SecureStore('playstation')
  private media?: { port: number; token: string }
  private ready?: Promise<void>
  private listening: Promise<PluginListenerHandle>
  private pending = new Map<number, Pending>()
  private nextId = 1
  private context: CatalogContext = DEFAULT_CONTEXT
  private infoCache = new Map<string, GameInfo>()
  private _status: PsStatus

  constructor(
    private notify: (status: PsStatus) => void,
    private push: (event: PsEvent) => void,
    private settings: () => AppSettings,
  ) {
    this._status = { state: this.npsso() ? 'signedIn' : 'signedOut' }
    this.listening = PsCore.addListener('line', ({ line }) => this.onLine(line))
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
    if (this._status.state === 'signingIn') return
    this.setStatus({ state: 'signingIn' })
    PsCore.signIn({ url: signInUrl(crypto.randomUUID()), redirect: SIGN_IN_REDIRECT, session: SESSION_URL })
      .then(({ npsso }) => this.acceptToken(npsso))
      .catch((e: { code?: string }) => {
        // Closing the sheet is a choice, not an error.
        this.setStatus({ state: 'signedOut', error: e?.code === 'CANCELLED' ? undefined : t('Sony giriş sayfası açılamadı. Ağ bağlantını kontrol et.') })
      })
  }

  private acceptToken(token: string) {
    this.vault.set('npsso', token)
    this.setStatus({ state: 'signedIn' })
  }

  signInWithToken(input: string) {
    this.acceptToken(extractNpsso(input))
  }

  async signOut() {
    this.vault.clear()
    this.infoCache.clear()
    await PsCore.signOut().catch(() => {})
    this.setStatus({ state: 'signedOut' })
  }

  private expire() {
    this.vault.delete('npsso')
    this.setStatus({ state: 'signedOut', error: sessionExpired() })
  }

  // --- core ----------------------------------------------------------------

  private ensureCore() {
    if (this.ready) return this.ready
    this.ready = (async () => {
      await this.listening
      this.media = await PsCore.start()
    })().catch((e) => {
      this.ready = undefined
      throw new Error(reason(e, t('PlayStation çekirdeği başlatılamadı.')))
    })
    return this.ready
  }

  private onLine(line: string) {
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.ev) return this.push(msg)
    const waiter = this.pending.get(msg.id)
    this.pending.delete(msg.id)
    if (msg.ok) waiter?.resolve(msg)
    else {
      if (msg.error === 'AUTHORIZATION_FAILED') this.expire()
      waiter?.reject(new Error(friendlyError(String(msg.error ?? ''))))
    }
  }

  private call(cmd: string, args: Record<string, unknown>) {
    const id = this.nextId++
    return new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      PsCore.command({ line: JSON.stringify({ id, cmd, ...args }) }).catch((e) => {
        this.pending.delete(id)
        reject(new Error(reason(e, t('PlayStation çekirdeğine ulaşılamadı.'))))
      })
    })
  }

  // --- catalog and streaming -----------------------------------------------

  async catalog(force: boolean): Promise<PsCatalog> {
    await this.ensureCore()
    const language = navigator.language || 'en-US'
    const { catalog } = await this.call('catalog', {
      npsso: this.npsso(),
      locale: this.vault.get('locale', language.includes('-') ? language : 'en-US'),
      // The plugin's own cache folder.
      cacheDir: '',
      force,
    })
    if (catalog.settledLocale) this.vault.set('locale', catalog.settledLocale)
    this.context = catalogContext(catalog)
    return { games: catalog.games ?? [], warning: catalog.warning ? catalogWarning() : '', nativeMode: catalog.nativeMode }
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
    void PsCore.controllerMotion({ on: true }).catch(() => {})
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
      const res = await fetch(page, { headers: { 'Accept-Language': locale } }).catch(() => undefined)
      if (res?.ok) {
        html = await res.text()
        if (storePageHasDetails(html)) break
      }
    }
    const info = parseStorePage(html)
    this.infoCache.set(game.productId, info)
    return info
  }

  async stop() {
    void PsCore.controllerMotion({ on: false }).catch(() => {})
    if (this.ready) await PsCore.command({ line: JSON.stringify({ cmd: 'stop' }) }).catch(() => {})
  }
}
