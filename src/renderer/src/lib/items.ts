import type { PsGame, XboxTitle } from '../../../shared/types'
import { t, type Message } from '../../../shared/i18n'

export type Service = 'playstation' | 'xbox'

// One shape for a game from either service, so the hub can treat them alike.
export interface HubItem {
  key: string
  service: Service
  name: string
  art?: string
  /** Square artwork for launcher and library tiles. */
  icon?: string
  hero?: string
  subtitle: string
  badge?: string
  action: 'play' | 'store' | 'none'
  storeUrl?: string
  ps?: PsGame
  xbox?: XboxTitle
}

const SERVICE_LABEL: Record<Service, string> = { playstation: 'PlayStation', xbox: 'Xbox' }
export const serviceLabel = (service: Service) => SERVICE_LABEL[service]

// Every PlayStation cloud stream needs Premium, which the catalog cannot report.
export const canStart = (item: HubItem, psPremium: boolean) => item.action === 'play' && (item.service === 'xbox' || psPremium)

const GENRES: Record<string, Message> = {
  ACTION: 'Aksiyon', ADVENTURE: 'Macera', ROLE_PLAYING_GAMES: 'Rol yapma', ROLE_PLAYING_GAME: 'Rol yapma', SHOOTER: 'Nişancı',
  RACING: 'Yarış', SPORTS: 'Spor', STRATEGY: 'Strateji', PUZZLE: 'Bulmaca', FIGHTING: 'Dövüş', SIMULATION: 'Simülasyon',
  SIMULATOR: 'Simülasyon', ARCADE: 'Arcade', FAMILY: 'Aile', HORROR: 'Korku', MUSIC: 'Müzik', MUSIC_RHYTHM: 'Müzik', PARTY: 'Parti',
  UNIQUE: 'Özgün', CASUAL: 'Gündelik', EDUCATIONAL: 'Eğitici',
}

// The two Sony catalogs describe a game with different fields.
export function psFacts(game: PsGame) {
  const raw = game.genre ?? game.metadata?.genre?.values ?? []
  return {
    genres: (Array.isArray(raw) ? raw : [raw]).map((g) => (GENRES[g] ? t(GENRES[g]) : undefined) ?? g.charAt(0) + g.slice(1).toLowerCase().replaceAll('_', ' ')),
    publisher: game.provider_name,
    release: game.releaseDate ?? game.release_date,
    rating: game.ageRating?.description ?? (game.age_limit ? `${game.age_limit}+` : undefined),
  }
}

const inStore = (game: PsGame) => game.category === 'purchaseable'

export function psItem(game: PsGame): HubItem {
  const store = inStore(game)
  const platform = game.platform.toUpperCase()
  const genre = psFacts(game).genres[0]
  return {
    key: `ps:${game.productId}`,
    service: 'playstation',
    name: game.name,
    art: game.imageUrl || game.landscapeImageUrl,
    icon: game.imageUrl || game.landscapeImageUrl,
    hero: game.landscapeImageUrl || undefined,
    subtitle: [platform, genre, game.freeToPlay ? t('Ücretsiz') : store ? t('Mağazada') : undefined].filter(Boolean).join(' · '),
    badge: game.isOwned ? t('Sahip') : game.freeToPlay ? t('Ücretsiz') : platform,
    action: store ? 'store' : 'play',
    storeUrl: game.conceptUrl,
    ps: game,
  }
}

// Store images come at full size unless asked otherwise; a grid of those stalls.
export function sized(url: string | undefined, width: number) {
  if (!url?.includes('store-images.s-microsoft.com') || url.includes('?')) return url
  return `${url}?mode=scale&q=85&w=${width}`
}

export function xboxItem(title: XboxTitle): HubItem {
  return {
    key: `xbox:${title.titleId}`,
    service: 'xbox',
    name: title.name,
    art: sized(title.poster ?? title.image, 360),
    icon: sized(title.image ?? title.poster, 320),
    hero: sized(title.hero, 1920),
    subtitle: [title.publisher, title.categories[0]].filter(Boolean).join(' · ') || 'Xbox',
    badge: title.owned ? t('Sahip') : title.entitled ? 'Game Pass' : undefined,
    action: title.entitled ? 'play' : 'none',
    xbox: title,
  }
}

const normalize = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

// Cloud titles know how to stream, the account library knows what is owned;
// they share no id, so the name is what ties them together.
export function mergeXbox(cloud: XboxTitle[], library: XboxTitle[]): XboxTitle[] {
  const byName = new Map(library.map((t) => [normalize(t.name), t]))
  const merged = cloud.map((title) => {
    const own = byName.get(normalize(title.name))
    if (!own) return title
    byName.delete(normalize(title.name))
    return { ...title, owned: own.owned, gamePass: own.gamePass, lastPlayed: own.lastPlayed, hero: title.hero ?? own.hero }
  })
  return [...merged, ...byName.values()]
}
