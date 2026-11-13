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
}

export interface XboxSession {
  id: string
  playerState: 'pending' | 'started' | 'queued' | 'failed'
  state?: string
  waitingSeconds?: number
  error?: string
}

/** What a game's page shows, gathered from the stores. */
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
}

export interface PsDatacenter {
  name: string
  rttMs?: number
}

export interface PsStreamStarted {
  url: string
  codec: 'h264' | 'h265'
  width: number
  height: number
}

export type PsEvent =
  | { ev: 'progress'; stage: string }
  | { ev: 'connected' }
  | { ev: 'quit'; reason: string; detail: string; error: boolean }
  | { ev: 'dualsense'; transport?: 'usb' | 'bluetooth' }

export interface HarganApi {
  platform: { fullscreen(on: boolean): void; toggleFullscreen(): void; streaming(on: boolean): void; openExternal(url: string): void; openLicenses(): void; log?(text: string): void; reportError?(text: string): void; exportDiagnostics?(): Promise<string | undefined> }
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
    onStatus(cb: (s: PsStatus) => void): () => void
    onEvent(cb: (e: PsEvent) => void): () => void
  }
}
