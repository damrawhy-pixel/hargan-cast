// Contract between the main process and the renderer.
import type { AppSettings } from './settings'

export type AccountState = 'signedOut' | 'restoring' | 'signingIn' | 'signedIn'

export interface XboxStatus {
  state: AccountState
  gamertag?: string
  gamerpic?: string
  gamerscore?: string
  hasCloud: boolean
  cloudError?: string
  servers?: string[]
  error?: string
}

export interface PsStatus {
  state: AccountState
  error?: string
}

export interface XboxTitle {
  titleId: string
  productId: string
  name: string
  publisher?: string
  image?: string
  poster?: string
  categories: string[]
  recent: boolean
  hero?: string
  /** Reachable through the cloud with this account right now. */
  entitled?: boolean
  /** Present in the cloud catalog at all. */
  cloud?: boolean
  owned?: boolean
  gamePass?: boolean
  lastPlayed?: string
  /** Set when this is the user's own console (xHome) rather than a cloud game: its server id. */
  home?: string
}

export interface XboxAchievement {
  id: string
  name: string
  description: string
  gamerscore: number
  unlocked: boolean
  /** 0..100 for ones with a counter, while not unlocked. */
  progress?: number
  icon?: string
  secret: boolean
  unlockedAt?: string
}

export interface XboxAchievements {
  unlocked: number
  total: number
  gamerscore: number
  totalGamerscore: number
  list: XboxAchievement[]
}

export interface XboxFriend {
  xuid: string
  gamertag: string
  picture?: string
  online: boolean
  /** "Playing Forza Horizon 5", "Last seen 2h ago: Home", ... in the account's language. */
  status: string
  favorite: boolean
}

/** An Xbox the account can stream from over the internet or at home. */
export interface XboxConsole {
  serverId: string
  name: string
  /** XboxSeriesX, XboxSeriesS, XboxOne, ... */
  type: string
  /** On, ConnectedStandby (instant-on, can be woken) or Off. */
  powerState: string
  streamingEnabled: boolean
}

export interface XboxSession {
  id: string
  playerState: 'pending' | 'started' | 'queued' | 'failed'
  state?: string
  waitingSeconds?: number
  error?: string
}

/** What a game's page shows, gathered from the stores. */
export interface NetworkProbe {
  name: string
  host: string
  rttMs?: number
  jitterMs?: number
  failed?: boolean
}

export interface NetworkReport {
  adapter?: { name: string; kind: 'wired' | 'wifi' | 'other'; linkSpeed?: string }
  probes: NetworkProbe[]
  /** Measured download speed, Mb/s; undefined when the measurement failed. */
  downloadMbps?: number
}

export interface GameInfo {
  description?: string
  developer?: string
  release?: string
  rating?: string
  hero?: string
  logo?: string
  screenshots: string[]
  /** Players' star rating in the store. */
  community?: { average: number; count: number }
}

export interface XboxActiveSession {
  id: string
  titleId: string
}

export interface PsGame {
  productId: string
  name: string
  imageUrl: string
  landscapeImageUrl: string
  category: 'owned' | 'streamable' | 'purchaseable'
  platform: 'ps3' | 'ps4' | 'ps5'
  isOwned: boolean
  streamServiceType: 'psnow' | 'pscloud'
  streamIdentifier: string
  entitlementId?: string
  conceptUrl?: string
  plusCatalog?: boolean
  freeToPlay?: boolean
  genre?: string[] | string
  releaseDate?: string
  release_date?: string
  provider_name?: string
  age_limit?: number
  ageRating?: { description?: string }
  metadata?: { genre?: { values?: string[] } }
}

export interface PsCatalog {
  games: PsGame[]
  warning: string
  nativeMode: boolean
}

export interface PsStreamOptions {
  hevc: boolean
  /** Remote Play on a PS5 only: ask for 10-bit HDR. */
  hdr?: boolean
  /** Remote Play from outside the home, brokered by PSN. */
  outside?: boolean
}

export interface PsDatacenter {
  name: string
  rttMs?: number
}

/** A console found on the network (or at a typed address). */
export interface PsFoundConsole {
  address: string
  name: string
  ps5: boolean
  state: 'ready' | 'standby' | 'unknown'
  hostId: string
  systemVersion: string
  runningApp: string
}

/** A console this app is linked to; its keys stay in the main process. */
export interface PsConsole {
  id: string
  name: string
  address: string
  ps5: boolean
  /** Set when a stream should go through PSN instead of the home network. */
  outside?: boolean
}

export interface PsStreamStarted {
  url: string
  codec: 'h264' | 'h265'
  width: number
  height: number
  /** Round trip to the server, measured as the session started. */
  rttMs?: number
}

export type PsEvent =
  | { ev: 'progress'; stage: string }
  | { ev: 'connected' }
  | { ev: 'quit'; reason: string; detail: string; error: boolean }
  | { ev: 'dualsense'; transport?: 'usb' | 'bluetooth' }

export interface NativeVideoStats {
  fps: number
  decodeMs: number
  mbps: number
  width: number
  height: number
  /** Sent once, when the first frame is on screen. */
  first: boolean
}

export interface NativeVideoTest {
  decoded: number
  decoder: string
  hardware?: boolean
  error?: string
}

/** The phones' native picture path for PlayStation streams (Android and iOS). */
export interface NativeVideoApi {
  /** Decodes a short clip off screen: does this phone's decoder take the stream? */
  test(): Promise<NativeVideoTest>
  start(options: { hevc: boolean; width: number; height: number }): Promise<void>
  stop(): Promise<void>
  onStats(cb: (stats: NativeVideoStats) => void): () => void
}

/** What PSN's connection broker will meet on this network. */
export interface NatReport {
  nat: 'cone' | 'symmetric' | 'blocked' | 'unknown'
  publicAddress?: string
  upnp: boolean
}

export interface SavedAccounts {
  /** The signed-in account's name ('' when it has none yet). */
  current: string
  others: { id: string; label: string }[]
}

/** Other accounts of a service, kept signed in on the side. */
export interface AccountsApi {
  list(): Promise<SavedAccounts>
  /** Sets the signed-in account aside (PlayStation names it `label`) and starts over for another. */
  add(label?: string): Promise<void>
  switch(id: string, label?: string): Promise<void>
  forget(id: string): Promise<SavedAccounts>
}

export interface HarganApi {
  platform: { fullscreen(on: boolean): void; toggleFullscreen(): void; streaming(on: boolean): void; openExternal(url: string): void; openLicenses(): void; windows?: boolean; log?(text: string): void; reportError?(text: string): void; exportDiagnostics?(): Promise<string | undefined>; networkTest?(): Promise<NetworkReport>; screenshot?(title: string): Promise<string | undefined>; saveClip?(title: string, data: ArrayBuffer): Promise<string>; showCapture?(file: string): void; takeLaunch?(): Promise<string | undefined>; dualSenseTriggers?(left: number, right: number): void; discord?: boolean; gameMode?: boolean; presence?(title: string, service: string): void; onLaunch?(cb: (target: string) => void): () => void; createShortcut?(key: string, name: string): Promise<string>; addToSteam?(key: string, name: string): Promise<number> }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
    reset(): Promise<AppSettings>
  }
  xbox: {
    status(): Promise<XboxStatus>
    signIn(): Promise<void>
    signOut(): Promise<void>
    titles(): Promise<XboxTitle[]>
    library(): Promise<XboxTitle[]>
    info(productId: string): Promise<GameInfo>
    startStream(titleId: string): Promise<string>
    /** The user's own consoles that allow remote play. */
    consoles(): Promise<XboxConsole[]>
    accounts?: AccountsApi
    /** The account's achievements in a game, or null when it has none or was never played. */
    achievements(productId: string, titleId: string): Promise<XboxAchievements | null>
    friends(): Promise<XboxFriend[]>
    startHomeStream(serverId: string): Promise<string>
    activeSessions(): Promise<XboxActiveSession[]>
    adoptSession(id: string, titleId: string): Promise<void>
    endSession(id: string, titleId: string): Promise<void>
    session(id: string): Promise<XboxSession | null>
    stopStream(id: string): Promise<void>
    sendSdp(id: string, sdp: string): Promise<{ sdp: string }>
    sendChatSdp(id: string, sdp: string): Promise<{ sdp: string }>
    sendIce(id: string, ice: unknown): Promise<unknown>
    keepalive(id: string): Promise<void>
    onStatus(cb: (s: XboxStatus) => void): () => void
  }
  ps: {
    status(): Promise<PsStatus>
    signIn(): Promise<void>
    signInWithToken(token: string): Promise<void>
    signOut(): Promise<void>
    catalog(force: boolean): Promise<PsCatalog>
    datacenters(service: 'pscloud' | 'psnow'): Promise<PsDatacenter[]>
    stream(game: PsGame, opts: PsStreamOptions): Promise<PsStreamStarted>
    stop(): Promise<void>
    testHaptics(): Promise<boolean>
    info(game: PsGame): Promise<GameInfo>
    routeSpeaker(): Promise<boolean>
    nativeVideo?: NativeVideoApi
    /** Desktop: can a console be reached through PSN from outside this network? */
    natTest?(): Promise<NatReport>
    accounts?: AccountsApi & { rename(label: string): Promise<void> }
    /** Remote Play with the user's own console. */
    consoles?: {
      list(): Promise<PsConsole[]>
      discover(host?: string): Promise<PsFoundConsole[]>
      register(found: PsFoundConsole, pin: string, accountId?: string): Promise<PsConsole>
      forget(id: string): Promise<PsConsole[]>
      moved(id: string, address: string): Promise<void>
      wake(id: string): Promise<void>
      stream(id: string, opts: PsStreamOptions): Promise<PsStreamStarted>
    }
    onStatus(cb: (s: PsStatus) => void): () => void
    onEvent(cb: (e: PsEvent) => void): () => void
  }
}
