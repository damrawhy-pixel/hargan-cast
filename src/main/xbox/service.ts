import https from 'node:https'
import axios from 'axios'
import { app, session } from 'electron'
import type { GameInfo, XboxAchievement, XboxAchievements, XboxActiveSession, XboxConsole, XboxFriend, XboxSession, XboxStatus, XboxTitle } from '../../shared/types'
import { log } from '../log'
import { contentLanguage, t } from '../../shared/i18n'
import Authentication from './authentication'
import { clearStreamToken, saveStreamToken } from './helpers/streamTokenStore'
import StreamManager from './helpers/streammanager'
import SecureStore from './secureStore'
import { AccountShelf } from '../accounts'
import TitleManager from './helpers/titlemanager'
import { clearWebToken } from './helpers/webTokenStore'
import xCloudApi from './helpers/xcloudapi'
import Store from './secureStore'
import { defaultSettings } from './settings'
import { settingsFor, type AppSettings } from '../../shared/settings'

// The application object the Xbox helpers call back into, plus the narrow API
// the renderer talks to.
const ACTIVE_SESSION_KEY = 'activeSession'
const RESUMABLE_STATES = new Set(['Provisioned', 'ReadyToConnect'])

export default class XboxService {
  _store = new Store('xbox')
  _authentication: Authentication
  _msalAuthentication: any = undefined
  streamingTokens: any
  webToken: any

  private _status: XboxStatus = { state: 'signedOut', hasCloud: false }
  private _cloudError?: string
  private _activeSession?: string
  private _streams: StreamManager
  private _titles: TitleManager

  constructor(private notify: (status: XboxStatus) => void, private settings: AppSettings) {
    this.storeSettings()
    this._authentication = new Authentication(this as any)
    this._authentication.startWebviewHooks()
    this._streams = new StreamManager(this)
    this._titles = new TitleManager(this)
    // Cached tokens can finish sign-in inside this call, so the state goes first.
    this.setStatus({ state: 'restoring' })
    if (!this._authentication.checkAuthentication()) this.setStatus({ state: 'signedOut' })
  }

  log(_namespace = 'xbox', ..._args: unknown[]) {}

  // The Xbox layer reads these when it asks for a session; a game's profile can
  // change them for the one session it starts.
  private storeSettings(settings = this.settings) {
    this._store.set('settings', {
      ...defaultSettings,
      preferred_game_language: settings.xboxGameLanguage,
      resolution: settings.xboxResolution,
      ipv6: settings.xboxIpv6,
      force_region_ip: settings.xboxRegionIp,
    })
  }

  private selectServer() {
    const token = this.streamingTokens?.xCloudToken
    const server = this.settings.xboxSignalServer
    if (server && token?.data.offeringSettings.regions.some((r: { name: string }) => r.name === server))
      token.setDefaultRegion(server)
  }

  applySettings(settings: AppSettings) {
    const regionChanged = settings.xboxRegionIp !== this.settings.xboxRegionIp
    this.settings = settings
    this.storeSettings()
    this.selectServer()
    if (regionChanged && this._status.state === 'signedIn') void this.retryCloud()
  }

  // Asks for the cloud token again, for when what it depends on has changed.
  private async retryCloud() {
    this._cloudError = undefined
    this._authentication._xal._xcloudToken = undefined
    clearStreamToken()
    const tokens = await this._authentication.getStreamingToken(this._authentication._tokenStore).catch(() => undefined)
    if (!tokens) return
    saveStreamToken(tokens)
    this.authenticationCompleted(tokens, this.webToken)
  }

  private setStatus(patch: Partial<XboxStatus>) {
    this._status = { ...this._status, ...patch }
    this.notify(this._status)
  }

  status() {
    return this._status
  }

  signIn() {
    this.setStatus({ state: 'signingIn', error: undefined })
    this._authentication.startAuthflow()
  }

  // The HTTP layer embeds status and body as JSON; nothing else in it is useful.
  cloudTokenFailed(error: Error) {
    const details = error?.message?.match(/Details:(\{[\s\S]*\})/)?.[1]
    try {
      const { statuscode, body } = JSON.parse(details ?? '')
      this._cloudError = `HTTP ${statuscode}: ${String(body).slice(0, 300)}`
    } catch {
      this._cloudError = String(error?.message ?? error).slice(0, 300)
    }
    log(`xbox cloud token refused: ${this._cloudError}`)
  }

  signInFailed(error: string) {
    this.setStatus({ state: 'signedOut', error })
  }

  signInWindowClosed() {
    if (this._status.state === 'signingIn' && !this._authentication._isAuthenticating)
      this.setStatus({ state: 'signedOut' })
  }

  // --- more than one account ------------------------------------------------

  private shelf = new AccountShelf(new SecureStore('accounts'), 'xbox', this._store)

  accounts() {
    return { current: this._status.gamertag ?? '', others: this.shelf.list() }
  }

  /** The signed-in account steps aside; sign-in starts over for another. */
  async addAccount() {
    this.shelf.park(this._status.gamertag ?? 'Xbox')
    await this.forgetSession()
    this._status = { state: 'signedOut', hasCloud: false }
    this.notify(this._status)
  }

  async switchAccount(id: string) {
    if (!this.shelf.swap(String(id), this._status.gamertag ?? 'Xbox')) return
    await this.forgetSession()
    // As at start: tokens from the vault, then a silent sign-in with them.
    this._authentication._tokenStore.load()
    this.setStatus({ state: 'restoring' })
    if (!this._authentication.checkAuthentication()) this.setStatus({ state: 'signedOut' })
  }

  forgetAccount(id: string) {
    this.shelf.forget(String(id))
    return this.accounts()
  }

  // What the previous account left in memory and in the sign-in window's cookies.
  private async forgetSession() {
    const store = this._authentication._tokenStore as any
    store._userToken = store._sisuToken = store._jwtKeys = undefined
    const xal = this._authentication._xal as any
    xal._webToken = xal._xhomeToken = xal._xcloudToken = undefined
    this.streamingTokens = undefined
    this.webToken = undefined
    this._activeSession = undefined
    this.titleIds.clear()
    this.storeSettings()
    await session.fromPartition('persist:xbox').clearStorageData()
  }

  async signOut() {
    clearStreamToken()
    clearWebToken()
    this._authentication._tokenStore.clear()
    this._store.clear()
    this.storeSettings()
    this.streamingTokens = undefined
    this.webToken = undefined
    await session.fromPartition('persist:xbox').clearStorageData()
    this._status = { state: 'signedOut', hasCloud: false }
    this.notify(this._status)
  }

  authenticationCompleted(streamingTokens: any, webToken: any) {
    this.streamingTokens = streamingTokens
    this.webToken = webToken
    this._authentication._isAuthenticating = false
    this._authentication._isAuthenticated = true
    const hasCloud = Boolean(streamingTokens.xCloudToken)
    this.selectServer()
    this.setStatus({
      state: 'signedIn',
      hasCloud,
      cloudError: hasCloud ? undefined : this._cloudError,
      servers: hasCloud ? streamingTokens.xCloudToken.data.offeringSettings.regions.map((r: { name: string }) => r.name) : [],
    })
    this.loadProfile().catch(() => {})
  }

  private xblGet(host: string, path: string, contract: string) {
    const claims = this.webToken.data.DisplayClaims.xui[0]
    return new Promise<any>((resolve, reject) => {
      const req = https.request(
        {
          host,
          path,
          headers: {
            Authorization: `XBL3.0 x=${claims.uhs};${this.webToken.data.Token}`,
            'x-xbl-contract-version': contract,
            'Accept-Language': this.settings.xboxGameLanguage || 'en-US',
            Accept: 'application/json',
          },
        },
        (res) => {
          let body = ''
          res.on('data', (d) => (body += d))
          res.on('end', () => {
            if (res.statusCode !== 200) return reject(new Error(`${host} HTTP ${res.statusCode}`))
            try {
              resolve(JSON.parse(body))
            } catch (e) {
              reject(e)
            }
          })
        },
      )
      req.setTimeout(20000, () => req.destroy(new Error(`Timed out: ${host}`)))
      req.on('error', reject)
      req.end()
    })
  }

  private async loadProfile() {
    const data = await this.xblGet('profile.xboxlive.com', '/users/me/profile/settings?settings=Gamertag,GameDisplayPicRaw,Gamerscore', '3')
    const settings: { id: string; value: string }[] = data.profileUsers[0].settings
    const read = (id: string) => settings.find((s) => s.id === id)?.value
    this.setStatus({ gamertag: read('Gamertag'), gamerpic: read('GameDisplayPicRaw'), gamerscore: read('Gamerscore') })
  }

  // The cloud catalog and the Microsoft Store each know part of a game's page.
  // Text comes in the interface language. The market stays US: the cloud catalog
  // this account streams from is the US offering, and other markets may not list it.
  async info(productId: string): Promise<GameInfo> {
    const language = contentLanguage()
    const [cloud, store] = await Promise.allSettled([
      axios.post(
        `https://catalog.gamepass.com/v3/products?market=US&language=${language}&hydration=RemoteHighSapphire0`,
        { Products: [productId] },
        {
          timeout: 15000,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'ms-cv': 0, 'calling-app-name': 'Xbox Cloud Gaming Web', 'calling-app-version': '24.17.63' },
        },
      ),
      axios.get(`https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${encodeURIComponent(productId)}&market=US&languages=${language},en-US`, { timeout: 15000 }),
    ])
    const product: any = cloud.status === 'fulfilled' ? Object.values(cloud.value.data.Products ?? {})[0] : undefined
    const listing: any = store.status === 'fulfilled' ? store.value.data.Products?.[0] : undefined
    const localized = listing?.LocalizedProperties?.[0]
    const images: { ImagePurpose: string; Uri: string }[] = localized?.Images ?? []
    const usage = listing?.MarketProperties?.[0]?.UsageData?.find((u: { AggregateTimeSpan: string }) => u.AggregateTimeSpan === 'AllTime')
    const shots: string[] = (product?.Screenshots ?? []).map((s: { URL: string }) => toHttps(s.URL))
    return {
      description: product?.ProductDescription || localized?.ProductDescription || product?.ProductDescriptionShort,
      developer: product?.DeveloperName ?? localized?.DeveloperName,
      release: product?.OriginalReleaseDate,
      rating: product?.ContentRating?.Description,
      hero: toHttps(product?.Image_Hero?.URL),
      screenshots: shots.length ? shots : images.filter((i) => i.ImagePurpose === 'Screenshot').map((i) => toHttps(i.Uri)!),
      community: usage?.RatingCount ? { average: usage.AverageRating, count: usage.RatingCount } : undefined,
    }
  }

  // The account's own games. Unlike the cloud catalog this has no regional gate.
  async library(): Promise<XboxTitle[]> {
    const xuid = this.webToken?.data.DisplayClaims.xui[0].xid
    if (!xuid) return []
    const data = await this.xblGet(
      'titlehub.xboxlive.com',
      `/users/xuid(${xuid})/titles/titlehistory/decoration/GamePass,Image,Detail?maxItems=1000`,
      '2',
    )
    const image = (t: any, ...types: string[]) => {
      for (const type of types) {
        const found = t.images?.find((i: any) => i.type?.toLowerCase() === type.toLowerCase())?.url
        if (found) return toHttps(found)
      }
      return undefined
    }
    return (data.titles ?? [])
      .filter((t: any) => t.type === 'Game')
      .map((t: any): XboxTitle => ({
        titleId: String(t.titleId),
        productId: t.detail?.productId ?? '',
        name: t.name,
        publisher: t.detail?.publisherName,
        image: toHttps(t.displayImage),
        poster: image(t, 'Poster', 'BoxArt') ?? toHttps(t.displayImage),
        hero: image(t, 'SuperHeroArt', 'Hero', 'TitledHeroArt'),
        categories: t.detail?.genres ?? [],
        recent: false,
        owned: !t.gamePass?.isGamePass,
        gamePass: Boolean(t.gamePass?.isGamePass),
        lastPlayed: t.titleHistory?.lastTimePlayed,
      }))
  }

  // Achievements live under Xbox Live's numeric title id; a cloud title is known by
  // its product id, so the account's title history links the two.
  private titleIds = new Map<string, string>()

  private async numericTitleId(productId: string, titleId: string) {
    if (/^\d+$/.test(titleId)) return titleId
    if (!this.titleIds.size) for (const t of await this.library().catch(() => [])) if (t.productId) this.titleIds.set(t.productId, t.titleId)
    return this.titleIds.get(productId)
  }

  async achievements(productId: string, titleId: string): Promise<XboxAchievements | null> {
    const xuid = this.webToken?.data.DisplayClaims.xui[0].xid
    const id = xuid ? await this.numericTitleId(String(productId), String(titleId)) : undefined
    if (!id) return null
    const data = await this.xblGet('achievements.xboxlive.com', `/users/xuid(${xuid})/achievements?titleId=${id}&maxItems=1000`, '2')
    const list: XboxAchievement[] = (data.achievements ?? []).map((a: any) => {
      const unlocked = a.progressState === 'Achieved'
      const requirement = a.progression?.requirements?.[0]
      const current = Number(requirement?.current)
      const target = Number(requirement?.target)
      return {
        id: String(a.id),
        name: String(a.name ?? ''),
        description: String((unlocked ? a.description : a.lockedDescription) || a.description || ''),
        gamerscore: Number(a.rewards?.find((r: any) => r.type === 'Gamerscore')?.value ?? 0),
        unlocked,
        progress: !unlocked && target > 0 && current >= 0 ? Math.min(100, Math.round((current / target) * 100)) : undefined,
        icon: toHttps(a.mediaAssets?.find((m: any) => m.type === 'Icon')?.url),
        secret: Boolean(a.isSecret) && !unlocked,
        unlockedAt: unlocked ? a.progression?.timeUnlocked : undefined,
      }
    })
    if (!list.length) return null
    // Unlocked first, newest first; then the rest by how close they are.
    list.sort((x, y) => Number(y.unlocked) - Number(x.unlocked) || (y.unlockedAt ?? '').localeCompare(x.unlockedAt ?? '') || (y.progress ?? 0) - (x.progress ?? 0))
    const done = list.filter((a) => a.unlocked)
    return {
      unlocked: done.length,
      total: list.length,
      gamerscore: done.reduce((sum, a) => sum + a.gamerscore, 0),
      totalGamerscore: list.reduce((sum, a) => sum + a.gamerscore, 0),
      list,
    }
  }

  async friends(): Promise<XboxFriend[]> {
    if (!this.webToken) return []
    const data = await this.xblGet('peoplehub.xboxlive.com', '/users/me/people/social/decoration/presencedetail', '5')
    return (data.people ?? [])
      .filter((p: any) => p.isFollowedByCaller !== false)
      .map((p: any): XboxFriend => ({
        xuid: String(p.xuid),
        gamertag: String(p.modernGamertag || p.gamertag || ''),
        picture: toHttps(p.displayPicRaw),
        online: p.presenceState === 'Online',
        status: String(p.presenceText ?? ''),
        favorite: Boolean(p.isFavorite),
      }))
      .sort((a: XboxFriend, b: XboxFriend) => Number(b.online) - Number(a.online) || Number(b.favorite) - Number(a.favorite) || a.gamertag.localeCompare(b.gamertag))
  }

  /** The cloud region this account streams through, when it has one. */
  regionUrl(): string | undefined {
    const token = this.streamingTokens?.xCloudToken
    return token ? `${token.getDefaultRegion().baseUri}/` : undefined
  }

  private cloudApi() {
    const token = this.streamingTokens?.xCloudToken
    if (!token) throw new Error(t('Bu hesapta Cloud Gaming erişimi yok'))
    return new xCloudApi(this as any, token.getDefaultRegion().baseUri.substring(8), token.data.gsToken, 'cloud')
  }

  async titles(): Promise<XboxTitle[]> {
    const api = this.cloudApi()
    const [all, recent] = await Promise.all([api.getTitles() as Promise<any>, api.getRecentTitles().catch(() => null) as Promise<any>])
    const products = (await this._titles.getGamePassProducts(all.results)) as any[]
    const recentIds = new Set<string>((recent?.results ?? []).map((t: any) => t.titleId))
    return products.map((p) => ({
      titleId: p.titleId || p.XCloudTitleId,
      productId: p.productId,
      name: p.ProductTitle,
      publisher: p.PublisherName,
      image: toHttps(p.Image_Tile?.URL),
      poster: toHttps(p.Image_Poster?.URL),
      categories: p.LocalizedCategories ?? p.Categories ?? [],
      recent: recentIds.has(p.titleId),
      hero: toHttps(p.Image_Hero?.URL),
      entitled: Boolean(p.details?.hasEntitlement),
      cloud: true,
    }))
  }

  async startStream(titleId: string) {
    this.storeSettings(settingsFor(this.settings, `xbox:${titleId}`))
    const id = (await this._streams.startStream('cloud', titleId).finally(() => this.storeSettings())) as string
    this.trackSession({ id, titleId })
    return id
  }

  async consoles(): Promise<XboxConsole[]> {
    if (!this.streamingTokens?.xHomeToken) return []
    const list = (await this._streams.getConsoles()) as any[]
    return list.map((c) => ({
      serverId: String(c.serverId),
      name: String(c.deviceName || c.serverId),
      type: String(c.consoleType || ''),
      powerState: String(c.powerState || ''),
      streamingEnabled: c.consoleStreamingEnabled !== false,
    }))
  }

  /** Streams from the user's own console; no session to resume, it simply runs on. */
  async startHomeStream(serverId: string) {
    this.storeSettings(settingsFor(this.settings, `xbox:home:${serverId}`))
    return (await this._streams.startStream('home', serverId).finally(() => this.storeSettings())) as string
  }

  // Microsoft's own "active sessions" endpoint does not list running sessions, so
  // the session is remembered here and asked about directly on the next start.
  private trackSession(session?: XboxActiveSession) {
    this._activeSession = session?.id
    if (session) this._store.set(ACTIVE_SESSION_KEY, session)
    else this._store.delete(ACTIVE_SESSION_KEY)
  }

  private cloudRequest(method: string, path: string) {
    const api = this.cloudApi()
    return new Promise<{ status: number; body: string }>((resolve) => {
      const req = https.request({ host: api._host, path, method, headers: { Authorization: `Bearer ${api._token}` } }, (res) => {
        let body = ''
        res.on('data', (d) => (body += d))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      })
      req.setTimeout(8000, () => req.destroy())
      req.on('error', () => resolve({ status: 0, body: '' }))
      req.end()
    })
  }

  async activeSessions(): Promise<XboxActiveSession[]> {
    const saved = this._store.get<XboxActiveSession | undefined>(ACTIVE_SESSION_KEY)
    if (!saved || !this.streamingTokens?.xCloudToken) return []
    const { status, body } = await this.cloudRequest('GET', `/v5/sessions/cloud/${saved.id}/state`)
    let state = ''
    try {
      state = JSON.parse(body).state ?? ''
    } catch {
      // No JSON means no session worth rejoining.
    }
    log(`xbox saved session: HTTP ${status} state ${state || 'none'}`)
    if (status === 200 && RESUMABLE_STATES.has(state)) return [saved]
    this.trackSession(undefined)
    return []
  }

  adoptSession(id: string, titleId: string) {
    this._streams._sessions[id] = { id, target: titleId, path: `/v5/sessions/cloud/${id}`, type: 'cloud', playerState: 'started' }
    this.trackSession({ id, titleId })
  }

  endSession(id: string, titleId: string) {
    this.adoptSession(id, titleId)
    return this.stopStream(id)
  }

  stopActive() {
    return this._activeSession ? this.stopStream(this._activeSession) : undefined
  }

  session(id: string): XboxSession | null {
    const s = this._streams.getSession(id)
    if (!s) return null
    return {
      id: s.id,
      playerState: s.playerState as XboxSession['playerState'],
      state: s.state,
      waitingSeconds: s.waitingTimes?.estimatedTotalWaitTimeInSeconds,
      error: s.errorDetails ? `[${s.errorDetails.code}] ${s.errorDetails.message}` : undefined,
    }
  }

  async stopStream(id: string) {
    if (this._activeSession === id) this.trackSession(undefined)
    await this._streams.stopStream(id).then(
      () => log('xbox session stopped'),
      () => log('xbox session stop failed'),
    )
  }

  sendSdp(id: string, sdp: string) {
    return this._streams.sendSdp(id, sdp)
  }

  sendChatSdp(id: string, sdp: string) {
    return this._streams.sendChatSdp(id, sdp)
  }

  sendIce(id: string, ice: unknown) {
    return this._streams.sendIce(id, ice)
  }

  keepalive(id: string) {
    return this._streams.sendKeepalive(id).catch(() => {})
  }
}

function toHttps(url?: string) {
  if (!url) return undefined
  return url.startsWith('//') ? `https:${url}` : url.replace(/^http:/, 'https:')
}
