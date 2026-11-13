// The parts of the PlayStation service that are the same on the desktop and on
// phones: what Sony is asked, how its answers are read, and how errors are worded.
// Nothing here may import Electron or Node, so the phone apps can bundle it.
import { t } from '../../shared/i18n'
import type { AppSettings } from '../../shared/settings'
import type { GameInfo, PsDatacenter, PsGame, PsStreamOptions } from '../../shared/types'

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
export const SIGN_IN_PAGE_HOST = 'my.account.sony.com'
/** Hands over the signed-in session as {"npsso": "..."} to whoever holds Sony's cookies. */
export const SESSION_URL = 'https://ca.account.sony.com/api/v1/ssocookie'
export const SIGN_IN_REDIRECT = SIGN_IN_PARAMS.redirect_uri
const NPSSO_PATTERN = /[A-Za-z0-9]{40,128}/
// kb/s per resolution when bit rate is left on automatic. Sony asks for about 38 Mb/s at 4K.
const AUTO_BITRATE: Record<number, number> = { 720: 10000, 1080: 20000, 1440: 30000, 2160: 40000 }

export const sessionExpired = () => t('PlayStation oturumunun süresi doldu. Tekrar giriş yap.')
export const catalogWarning = () => t('Oturumun süresi doldu. Sahip olduğun oyunları görmek için tekrar giriş yap.')

export function signInUrl(cid: string) {
  const url = new URL(SIGN_IN_URL)
  for (const [k, v] of Object.entries(SIGN_IN_PARAMS)) url.searchParams.set(k, v)
  url.searchParams.set('cid', cid)
  return url.toString()
}

/** Pulls the NPSSO out of a pasted value or the token page's JSON. */
export function extractNpsso(input: string) {
  const match = input.match(NPSSO_PATTERN)
  if (!match) throw new Error(t('Bu bir NPSSO değerine benzemiyor'))
  return match[0]
}

export interface CatalogContext {
  country: string
  lang: string
  foreign: boolean
}

export const DEFAULT_CONTEXT: CatalogContext = { country: 'US', lang: 'en', foreign: false }

/** The lib settles region and language while fetching the catalog; streaming must reuse them verbatim. */
export function catalogContext(catalog: { settledLocale?: string; fallbackRegion?: string; resolvedStoreLang?: string; nativeMode?: boolean }): CatalogContext {
  const [lang = 'en', country = 'US'] = String(catalog.settledLocale || 'en-US').split('-')
  return {
    country: (catalog.fallbackRegion || country).toUpperCase(),
    lang: (catalog.resolvedStoreLang || lang).toLowerCase(),
    foreign: !catalog.nativeMode,
  }
}

/** What the account vault holds that a stream request needs. */
export interface StreamMemory {
  npsso: string
  locale: string
  attrPassed: boolean
  priorDatacenters: string
}

export const datacentersKey = (service: string) => `datacenters.${service}`

/** The core's `stream` command, minus its id. */
export function streamArgs(game: PsGame, opts: PsStreamOptions, settings: AppSettings, context: CatalogContext, memory: StreamMemory) {
  const owned = game.isOwned && game.streamServiceType === 'psnow'
  const cloud = game.streamServiceType === 'pscloud'
  const resolution = cloud ? settings.psCloudResolution : settings.psNowResolution
  return {
    service: game.streamServiceType,
    game: game.streamIdentifier,
    npsso: memory.npsso,
    country: context.country,
    lang: context.lang,
    gameLang: settings.psGameLanguage || memory.locale,
    ownedEntitlement: owned ? game.entitlementId ?? '' : '',
    ownedPlatform: owned ? game.platform : '',
    foreign: context.foreign,
    attrPassed: memory.attrPassed,
    datacenter: cloud ? settings.psCloudDatacenter : settings.psNowDatacenter,
    priorDatacenters: memory.priorDatacenters,
    hevc: opts.hevc,
    resolution,
    bitrate: (cloud ? settings.psCloudBitrate : settings.psNowBitrate) || (AUTO_BITRATE[resolution] ?? AUTO_BITRATE[1080]),
    packetLossMax: settings.psPacketLossMax,
    psChord: settings.psOptionsShareForPs,
    nativeDualSense: settings.psNativeDualSense,
    hapticStrength: settings.psHapticStrength,
    triggers: settings.psTriggers,
    vibration: settings.psVibration,
  }
}

/** Filled in by previous streams, which is when the servers get pinged. */
export function parseDatacenters(stored: string): PsDatacenter[] {
  let list: { dataCenter?: string; rtt?: number }[] = []
  try {
    list = JSON.parse(stored)
  } catch {
    return []
  }
  return list
    .filter((d) => d.dataCenter)
    .map((d) => ({ name: d.dataCenter!, rttMs: d.rtt }))
    .sort((a, b) => (a.rttMs ?? Infinity) - (b.rttMs ?? Infinity))
}

// --- store page -------------------------------------------------------------

/** Store pages that may describe a game, best first, and the language to ask in. */
export function storePages(game: PsGame, context: CatalogContext) {
  const locale = `${context.lang}-${context.country.toLowerCase()}`
  const pages = [`https://store.playstation.com/${locale}/product/${encodeURIComponent(game.productId)}`, game.conceptUrl].filter(Boolean) as string[]
  return { locale, pages }
}

/** True when a fetched store page carries the details worth showing. */
export const storePageHasDetails = (html: string) => html.includes('"role":"SCREENSHOT"') || html.includes('"type":"LONG"')

// The store page carries the long description, screenshots, logo and player
// rating inside its embedded data; the cloud catalog has none of them.
export function parseStorePage(html: string): GameInfo {
  const unescape = (s: string) => {
    try {
      return JSON.parse(`"${s}"`) as string
    } catch {
      return s
    }
  }
  const media = (role: string) => [...new Set([...html.matchAll(new RegExp(`"role":"${role}","type":"IMAGE","url":"(https:[^"]+)"`, 'g'))].map((m) => m[1]))]
  const long = html.match(/"__typename":"Description","type":"LONG","value":"((?:[^"\\]|\\.)*)"/)?.[1]
  const stars = html.match(/"averageRating":([\d.]+),"totalRatingsCount":(\d+)/)
  return {
    description: long && unescape(long).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim(),
    // The art the console itself shows behind a game.
    hero: media('GAMEHUB_COVER_ART')[0],
    logo: media('LOGO')[0],
    screenshots: media('SCREENSHOT').slice(0, 12),
    community: stars && Number(stars[2]) > 0 ? { average: Number(stars[1]), count: Number(stars[2]) } : undefined,
  }
}

export function friendlyError(message: string) {
  if (message === 'AUTHORIZATION_FAILED') return sessionExpired()
  if (message === 'PS_PLUS_SUBSCRIPTION_REQUIRED') return t('Bu oyun için PS Plus Premium aboneliği gerekiyor.')
  if (message === 'PING_TIMEOUT') return t('Veri merkezlerine ulaşılamadı. Bağlantını kontrol edip tekrar dene.')
  if (message === 'ACCOUNT_PRIVACY_SETTINGS') return t('Hesabının gizlilik ayarları bu oyuna izin vermiyor.')
  if (message.startsWith('Selected datacenter')) return t('Seçtiğin veri merkezi şu an kullanılamıyor. Ayarlardan başka birini seç.')
  if (message.startsWith('Timed out waiting')) return t('Akış sunucusu beklenirken süre doldu. Tekrar dene.')
  if (message.startsWith("Couldn't reach") || message.startsWith('Network error')) return t('PlayStation sunucularına ulaşılamadı. Bağlantını kontrol edip tekrar dene.')
  if (message.startsWith('Failed to fetch')) return t('PlayStation kataloğu alınamadı. Tekrar dene.')
  // What Sony sends back is a raw response body, not a sentence.
  if (message.startsWith('{')) return t('PlayStation isteği reddetti. Biraz sonra tekrar dene.')
  return message
}
