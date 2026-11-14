import { t } from '../../../shared/i18n'
import { useEffect, useRef, useState } from 'react'
import type { GameInfo } from '../../../shared/types'
import { gameInfo, imageAt, knownInfo, ratingText } from '../lib/gameInfo'
import { canStart, psFacts, serviceLabel, type HubItem } from '../lib/items'
import { setSpotlight, toggleFavorite, useStore } from '../lib/store'
import { GameProfile } from './GameProfile'
import { useSettings } from '../lib/useSettings'

const YEAR = (date?: string) => (date ? new Date(date).getFullYear() || undefined : undefined)
const SCREENSHOT_WIDTH = 480
const WIDE_WIDTH = 1920

interface Props {
  item: HubItem
  onClose(): void
  onPlay(item: HubItem, art: HTMLElement | null): void
  onOpenSettings(): void
}

export function GameDetail({ item, onClose, onPlay, onOpenSettings }: Props) {
  const { psPremium } = useSettings()
  const favorite = useStore((s) => s.favorites.includes(item.key))
  const [info, setInfo] = useState<GameInfo | undefined>(() => knownInfo(item))
  const [shot, setShot] = useState<string>()
  const art = useRef<HTMLImageElement>(null)
  const action = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    action.current?.focus()
    setSpotlight(item)
  }, [item])

  useEffect(() => {
    let stale = false
    void gameInfo(item).then((found) => !stale && found && setInfo(found))
    return () => {
      stale = true
    }
  }, [item])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const startable = canStart(item, psPremium)
  const ps = item.ps && psFacts(item.ps)
  const backdrop = shot ?? (info?.hero && imageAt(info.hero, WIDE_WIDTH)) ?? item.hero
  const publisher = item.xbox?.publisher ?? ps?.publisher
  const facts = [
    serviceLabel(item.service),
    info?.developer && info.developer !== publisher ? info.developer : undefined,
    publisher,
    YEAR(info?.release ?? ps?.release),
    info?.rating ?? ps?.rating,
    ...(item.xbox?.categories.slice(0, 2) ?? ps?.genres.slice(0, 2) ?? []),
    ratingText(info?.community),
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
                <button ref={action} className="primary big" data-nav onClick={() => onPlay(item, null)}>{t('Mağazada aç')}</button>
              ) : item.action === 'none' ? (
                <button ref={action} className="primary big" data-nav disabled>{item.xbox?.cloud ? t('Hesabınla açılmıyor') : t('Cloud Gaming kataloğunda yok')}</button>
              ) : startable ? (
                <button ref={action} className="primary big" data-nav onClick={() => onPlay(item, art.current)}>{t('Oyna')}</button>
              ) : (
                <button ref={action} className="primary big" data-nav onClick={onOpenSettings}>{t('PS Plus Premium gerekiyor')}</button>
              )}
              <button className="ghost big" data-nav aria-pressed={favorite} onClick={() => toggleFavorite(item.key)}>
                {favorite ? `★ ${t('Favorilerden çıkar')}` : `☆ ${t('Favorilere ekle')}`}
              </button>
              <button className="ghost big detail-back" data-nav onClick={onClose}>{t('Geri')}</button>
            </div>
            {item.action === 'play' && <GameProfile item={item} />}
          </div>
        </div>

        {info && info.screenshots.length > 0 && (
          <div className="detail-shots">
            {info.screenshots.map((url) => (
              <button key={url} className="detail-shot" data-nav aria-label={t('Ekran görüntüsü')} onFocus={() => setShot(imageAt(url, WIDE_WIDTH))} onMouseEnter={() => setShot(imageAt(url, WIDE_WIDTH))}>
                <img src={imageAt(url, SCREENSHOT_WIDTH)} alt="" loading="lazy" decoding="async" draggable={false} />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
