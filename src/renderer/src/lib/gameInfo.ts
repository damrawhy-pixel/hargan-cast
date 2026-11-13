import { locale, t } from '../../../shared/i18n'
import type { GameInfo } from '../../../shared/types'
import { sized, type HubItem } from './items'

const requests = new Map<string, Promise<GameInfo | undefined>>()
const known = new Map<string, GameInfo>()

/** A game's page from its store, fetched once per session. */
export function gameInfo(item: HubItem): Promise<GameInfo | undefined> {
  let request = requests.get(item.key)
  if (!request) {
    const ask = item.xbox?.productId ? window.hc.xbox.info(item.xbox.productId) : item.ps ? window.hc.ps.info(item.ps) : undefined
    request = (ask ?? Promise.resolve(undefined)).then(
      (info) => {
        if (info) known.set(item.key, info)
        return info
      },
      () => {
        requests.delete(item.key)
        return undefined
      },
    )
    requests.set(item.key, request)
  }
  return request
}

export const knownInfo = (item: HubItem) => known.get(item.key)

// Both stores serve originals of several megabytes unless a width is asked for.
export function imageAt(url: string, width: number) {
  if (url.includes('image.api.playstation.com') && !url.includes('?')) return `${url}?w=${width}`
  return sized(url, width) ?? url
}

export const ratingText = (community: GameInfo['community']) =>
  community ? `★ ${community.average.toLocaleString(locale(), { maximumFractionDigits: 1 })} · ${t('{n} oy', { n: community.count.toLocaleString(locale()) })}` : undefined
