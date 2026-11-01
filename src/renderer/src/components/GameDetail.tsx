import { useEffect, useRef, useState } from 'react'
import type { XboxDetails } from '../../../shared/types'
import { canStart, psFacts, serviceLabel, sized, type HubItem } from '../lib/items'
import { setSpotlight } from '../lib/store'
import { useSettings } from '../lib/useSettings'

const YEAR = (date?: string) => (date ? new Date(date).getFullYear() || undefined : undefined)
const SCREENSHOT_WIDTH = 480
const WIDE_WIDTH = 1920

const cache = new Map<string, XboxDetails>()

interface Props {
  item: HubItem
  onClose(): void
  onPlay(item: HubItem, art: HTMLElement | null): void
  onOpenSettings(): void
}

export function GameDetail({ item, onClose, onPlay, onOpenSettings }: Props) {
  const { psPremium } = useSettings()
  const productId = item.xbox?.productId
  const [info, setInfo] = useState<XboxDetails | undefined>(productId ? cache.get(productId) : undefined)
  const [shot, setShot] = useState<string>()
  const art = useRef<HTMLImageElement>(null)
  const action = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    action.current?.focus()
    setSpotlight(item)
  }, [item])

  useEffect(() => {
    if (!productId || cache.has(productId)) return
    let stale = false
    window.hc.xbox
      .details(productId)
      .then((details) => {
        if (!details) return
        cache.set(productId, details)
        if (!stale) setInfo(details)
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [productId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const startable = canStart(item, psPremium)
  const ps = item.ps && psFacts(item.ps)
  const backdrop = shot ?? sized(info?.hero, WIDE_WIDTH) ?? item.hero
  const publisher = item.xbox?.publisher ?? ps?.publisher
  const facts = [
    serviceLabel(item.service),
    info?.developer && info.developer !== publisher ? info.developer : undefined,
    publisher,
    YEAR(info?.release ?? ps?.release),
    info?.rating ?? ps?.rating,
    ...(item.xbox?.categories.slice(0, 2) ?? ps?.genres.slice(0, 2) ?? []),
  ].filter(Boolean)

  return (
    <section className="detail" data-theme={item.service} role="dialog" aria-label={item.name}>
      {(backdrop ?? item.art) && (
        <div key={backdrop ?? item.art} className={`detail-backdrop ${backdrop ? '' : 'detail-backdrop--soft'}`} style={{ backgroundImage: `url("${backdrop ?? item.art}")` }} />
      )}
      <div className="detail-shade" />

      <div className="detail-body">
        <div className="detail-main">
          {item.art && <img ref={art} className="detail-art" src={item.art} alt="" draggable={false} />}
          <div className="detail-copy">
            {item.badge && <span className="detail-badge">{item.badge}</span>}
            <h1>{item.name}</h1>
            <p className="detail-facts">{facts.join(' · ')}</p>
            {info?.description && <p className="detail-text">{info.description}</p>}
            <div className="detail-actions">
              {item.action === 'store' ? (
                <button ref={action} className="primary big" data-nav onClick={() => onPlay(item, null)}>Mağazada aç</button>
              ) : item.action === 'none' ? (
                <button ref={action} className="primary big" data-nav disabled>{item.xbox?.cloud ? 'Hesabınla açılmıyor' : 'Cloud Gaming kataloğunda yok'}</button>
              ) : startable ? (
                <button ref={action} className="primary big" data-nav onClick={() => onPlay(item, art.current)}>Oyna</button>
              ) : (
                <button ref={action} className="primary big" data-nav onClick={onOpenSettings}>PS Plus Premium gerekiyor</button>
              )}
              <button className="ghost big detail-back" data-nav onClick={onClose}>Geri</button>
            </div>
          </div>
        </div>

        {info && info.screenshots.length > 0 && (
          <div className="detail-shots">
            {info.screenshots.map((url) => (
              <button key={url} className="detail-shot" data-nav aria-label="Ekran görüntüsü" onFocus={() => setShot(sized(url, WIDE_WIDTH))} onMouseEnter={() => setShot(sized(url, WIDE_WIDTH))}>
                <img src={sized(url, SCREENSHOT_WIDTH)} alt="" loading="lazy" decoding="async" draggable={false} />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
