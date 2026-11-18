// Remote Play with the user's own consoles, the same on the desktop and on phones:
// linking with a console's PIN, waking it, and starting a stream at home or, through
// PSN, from anywhere. The console's keys stay here and in the account vault; the
// page only ever sees names and addresses. Nothing here may import Electron or
// Node, so the phone apps can bundle it.
import { t } from '../../shared/i18n'
import { settingsFor, type AppSettings } from '../../shared/settings'
import type { PsConsole, PsFoundConsole, PsStreamOptions, PsStreamStarted } from '../../shared/types'
import { accountIdBase64, REMOTE_PLAY_CLIENT, remoteStreamArgs, sessionExpired, validAccountId } from './common'

const QUICK_TIMEOUT_MS = 20_000
const CONSOLE_TIMEOUT_MS = 30_000
const SONY_AUTHORIZE = 'https://ca.account.sony.com/api/authz/v3/oauth/authorize'
const SONY_TOKEN = 'https://ca.account.sony.com/api/authz/v3/oauth/token'
const SONY_ACCOUNT = 'https://dms.api.playstation.com/api/v1/devices/accounts/me'
// Every PSN device id this app makes starts like the official app's.
const DUID_PREFIX = '0000000700410080'

/** A linked console with the keys the core needs. */
interface StoredConsole extends PsConsole {
  registKey: string
  rpKey: string
  /** Its id with PSN, once looked up, for connecting from outside the home. */
  psnUid?: string
}

interface Token {
  access: string
  refresh?: string
  expires: number
}

/** A fetch that carries the saved Sony session (the npsso cookie) to Sony's login. */
export type SonyFetch = (url: string, init?: RequestInit) => Promise<Response>

export interface ConsoleHost {
  vault: { get<T>(key: string, fallback: T): T; set(key: string, value: unknown): void }
  npsso(): string
  settings(): AppSettings
  ensureCore(): Promise<void>
  call(cmd: string, args: Record<string, unknown>, timeoutMs?: number): Promise<any>
  /** The media socket's address once the core runs. */
  mediaUrl(): string | undefined
  /** Fetch with the npsso cookie, then the cleanup it needs. */
  sonyFetch(npsso: string): Promise<{ fetch: SonyFetch; done(): void }>
  log(text: string): void
  /** Random bytes as hex, from the platform's secure source. */
  randomHex(bytes: number): string
}

const basic = () => btoa(`${REMOTE_PLAY_CLIENT.id}:${REMOTE_PLAY_CLIENT.secret}`)

export class Consoles {
  constructor(private host: ConsoleHost) {}

  private stored(): StoredConsole[] {
    return this.host.vault.get<StoredConsole[]>('consoles', [])
  }

  list(): PsConsole[] {
    return this.stored().map(({ id, name, address, ps5 }) => ({ id, name, address, ps5 }))
  }

  /** Consoles on the local network, or at a typed address (another network, a VPN). */
  async discover(address?: string): Promise<PsFoundConsole[]> {
    await this.host.ensureCore()
    const { consoles } = await this.host.call('console', { action: 'discover', host: typeof address === 'string' ? address.trim() : '' }, QUICK_TIMEOUT_MS)
    return consoles ?? []
  }

  // This app's device id with PSN, made once: PSN ties its connection broker to it.
  private duid() {
    let duid = this.host.vault.get<string>('duid', '')
    if (!duid) {
      duid = DUID_PREFIX + this.host.randomHex(16)
      this.host.vault.set('duid', duid)
    }
    return duid
  }

  private async tokenRequest(fetch: SonyFetch, body: Record<string, string>) {
    const res = await fetch(SONY_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic()}` },
      body: new URLSearchParams({ ...body, token_format: 'jwt' }).toString(),
    })
    return (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
  }

  /**
   * An access token from the Remote Play app's own login, which the saved session
   * can do silently; kept with its refresh token so later ones need no login.
   */
  async token(): Promise<string> {
    const saved = this.host.vault.get<Token | undefined>('psnToken', undefined)
    if (saved && saved.expires > Date.now() + 60_000) return saved.access
    const npsso = this.host.npsso()
    if (!npsso) throw new Error(sessionExpired())
    const keep = (r: { access_token?: string; refresh_token?: string; expires_in?: number }) => {
      if (!r.access_token) throw new Error('token')
      this.host.vault.set('psnToken', { access: r.access_token, refresh: r.refresh_token ?? saved?.refresh, expires: Date.now() + (r.expires_in ?? 3600) * 1000 } satisfies Token)
      return r.access_token
    }
    const session = await this.host.sonyFetch(npsso)
    try {
      if (saved?.refresh) {
        const refreshed = await this.tokenRequest(session.fetch, { grant_type: 'refresh_token', refresh_token: saved.refresh, scope: REMOTE_PLAY_CLIENT.scope }).catch(() => undefined)
        if (refreshed?.access_token) return keep(refreshed)
      }
      const authorize = new URL(SONY_AUTHORIZE)
      for (const [k, v] of Object.entries({ response_type: 'code', client_id: REMOTE_PLAY_CLIENT.id, redirect_uri: REMOTE_PLAY_CLIENT.redirect, scope: REMOTE_PLAY_CLIENT.scope, service_entity: 'urn:service-entity:psn', prompt: 'none', duid: this.duid() }))
        authorize.searchParams.set(k, v)
      // Sony answers with a redirect to the Remote Play page carrying the code.
      const redirected = await session.fetch(authorize.toString(), { cache: 'no-store' })
      const code = new URL(redirected.url).searchParams.get('code')
      if (!code) throw new Error('code')
      return keep(await this.tokenRequest(session.fetch, { grant_type: 'authorization_code', code, redirect_uri: REMOTE_PLAY_CLIENT.redirect }))
    } finally {
      session.done()
    }
  }

  /** The PSN account id, which a console wants at linking. */
  private async accountId(): Promise<string> {
    const cached = this.host.vault.get<string>('accountId', '')
    if (cached) return cached
    try {
      const access = await this.token()
      const me = await fetch(SONY_ACCOUNT, { headers: { Authorization: `Bearer ${access}` } })
      const { accountId } = (await me.json()) as { accountId?: string | number }
      if (!accountId) throw new Error('account')
      const id = accountIdBase64(String(accountId))
      this.host.vault.set('accountId', id)
      return id
    } catch (e) {
      this.host.log(`ps account id: ${(e as Error).message}`)
      throw new Error(t('PSN hesap kimliği alınamadı. Gelişmiş bölümünden elle girebilirsin.'))
    }
  }

  /** Links the app to a console with the PIN it shows; `accountId` overrides the looked-up one. */
  async register(found: { address: string; ps5: boolean; name?: string; hostId?: string }, pin: string, accountId?: string): Promise<PsConsole> {
    const digits = String(pin).replace(/\D/g, '')
    if (digits.length !== 8) throw new Error(t('PIN 8 haneli olmalı.'))
    if (accountId && !validAccountId(accountId)) throw new Error(t('Bu bir PSN hesap kimliğine benzemiyor.'))
    const account = accountId?.trim() || (await this.accountId())
    await this.host.ensureCore()
    const { console: linked } = await this.host.call('console', { action: 'register', host: found.address, ps5: found.ps5, accountId: account, pin: Number(digits) }, CONSOLE_TIMEOUT_MS)
    if (accountId) this.host.vault.set('accountId', account)
    const entry: StoredConsole = {
      id: found.hostId || linked.mac || this.host.randomHex(8),
      name: linked.name || found.name || (linked.ps5 ? 'PS5' : 'PS4'),
      address: found.address,
      ps5: Boolean(linked.ps5),
      registKey: linked.registKey,
      rpKey: linked.rpKey,
    }
    this.host.vault.set('consoles', [...this.stored().filter((c) => c.id !== entry.id), entry])
    return { id: entry.id, name: entry.name, address: entry.address, ps5: entry.ps5 }
  }

  forget(id: string) {
    this.host.vault.set('consoles', this.stored().filter((c) => c.id !== id))
    return this.list()
  }

  /** A console found at a new address (DHCP moved it) keeps its keys. */
  moved(id: string, address: string) {
    this.host.vault.set('consoles', this.stored().map((c) => (c.id === id ? { ...c, address } : c)))
  }

  async wake(id: string) {
    const target = this.stored().find((c) => c.id === id)
    if (!target) throw new Error(t('Konsol bulunamadı.'))
    await this.host.ensureCore()
    await this.host.call('console', { action: 'wake', host: target.address, ps5: target.ps5, registKey: target.registKey }, QUICK_TIMEOUT_MS)
  }

  /** The console's id with PSN, found once by its name and kept. */
  private async psnUid(target: StoredConsole, token: string): Promise<string> {
    if (target.psnUid) return target.psnUid
    await this.host.ensureCore()
    // The core takes the token in the field it reads for account ids.
    const { devices } = (await this.host.call('console', { action: 'psnDevices', accountId: token }, CONSOLE_TIMEOUT_MS)) as { devices: { uid: string; name: string; ps5: boolean; remotePlay: boolean }[] }
    const sameKind = devices.filter((d) => d.ps5 === target.ps5)
    const match = sameKind.find((d) => d.name.trim().toLowerCase() === target.name.trim().toLowerCase()) ?? (sameKind.length === 1 ? sameKind[0] : undefined)
    if (!match) throw new Error(t('Bu konsol PSN hesabında bulunamadı.'))
    if (!match.remotePlay) throw new Error(t('Konsolda Uzaktan Oynatma kapalı görünüyor.'))
    this.host.vault.set('consoles', this.stored().map((c) => (c.id === target.id ? { ...c, psnUid: match.uid } : c)))
    return match.uid
  }

  async stream(id: string, opts: PsStreamOptions): Promise<PsStreamStarted> {
    const target = this.stored().find((c) => c.id === id)
    if (!target) throw new Error(t('Konsol bulunamadı.'))
    await this.host.ensureCore()
    const settings = settingsFor(this.host.settings(), `console:${id}`)
    // Outside the home PSN brokers the connection; at home the console is asked directly.
    let psn: Record<string, string> = {}
    if (opts.outside) {
      const token = await this.token().catch(() => {
        throw new Error(t('PSN oturumu alınamadı. PlayStation hesabından çıkıp yeniden giriş yap.'))
      })
      psn = { psnToken: token, psnUid: await this.psnUid(target, token), accountId: await this.accountId() }
    }
    const reply = await this.host.call('remoteStream', { ...remoteStreamArgs(target, opts, settings), registKey: target.registKey, rpKey: target.rpKey, ...psn })
    const url = this.host.mediaUrl()
    if (!url) throw new Error(t('PlayStation çekirdeği beklenmedik şekilde kapandı'))
    return { url, codec: reply.codec, width: reply.width, height: reply.height }
  }
}
