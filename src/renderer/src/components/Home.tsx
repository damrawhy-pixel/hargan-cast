import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { canStart, serviceLabel, type HubItem } from '../lib/items'
import { clearXboxRunning, setSpotlight, useStore } from '../lib/store'
import { useSettings } from '../lib/useSettings'
import { GameTile } from './GameTile'
import type { Space } from './TopBar'

const ROW_SIZE = 18
const SCROLL_STEP = 0.8

interface Props {
  onOpen(item: HubItem, art: HTMLElement | null): void
  onPlay(item: HubItem, art: HTMLElement | null): void
  onGo(space: Space): void
  onResume(item: HubItem, sessionId: string): void
}

function Row({ title, onAll, children }: { title: string; onAll?(): void; children: ReactNode }) {
  const rail = useRef<HTMLDivElement>(null)
  const scroll = (sign: number) => rail.current?.scrollBy({ left: sign * rail.current.clientWidth * SCROLL_STEP, behavior: 'smooth' })
  return (
    <section className="row">
      <header className="row-head">
        <h2>{title}</h2>
        {onAll && <button className="row-all" onClick={onAll}>Tümünü gör</button>}
      </header>
      <div className="row-frame">
        <button className="row-arrow row-arrow--left" aria-label="Sola kaydır" tabIndex={-1} onClick={() => scroll(-1)}>‹</button>
        <div className="rail" ref={rail}>{children}</div>
        <button className="row-arrow row-arrow--right" aria-label="Sağa kaydır" tabIndex={-1} onClick={() => scroll(1)}>›</button>
      </div>
    </section>
  )
}

function SpaceCard({ space, title, detail, onGo }: { space: Space; title: string; detail: string; onGo(space: Space): void }) {
  return (
    <button className={`space-card space-card--${space}`} data-nav onClick={() => onGo(space)}>
      <strong>{title}</strong>
      <span>{detail}</span>
    </button>
  )
}

const shuffleKey = (key: string) => [...key].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 7)

export function Home({ onOpen, onPlay, onGo, onResume }: Props) {
  const psItems = useStore((s) => s.psItems)
  const xboxItems = useStore((s) => s.xboxItems)
  const ps = useStore((s) => s.ps)
  const xbox = useStore((s) => s.xbox)
  const recentKeys = useStore((s) => s.recents)
  const spotlight = useStore((s) => s.spotlight)
  const running = useStore((s) => s.xboxRunning)
  const { psPremium } = useSettings()
  const runningItem = running && xboxItems.find((i) => i.xbox?.titleId === running.titleId)

  const rows = useMemo(() => {
    const byKey = new Map([...psItems, ...xboxItems].map((i) => [i.key, i]))
    const lastPlayed = (i: HubItem) => i.xbox?.lastPlayed ?? ''
    return {
      recent: recentKeys.map((k) => byKey.get(k)).filter((i): i is HubItem => Boolean(i)),
      xboxPlay: xboxItems.filter((i) => i.action === 'play').sort((a, b) => lastPlayed(b).localeCompare(lastPlayed(a))).slice(0, ROW_SIZE),
      psPlay: psItems.filter((i) => i.action === 'play').sort((a, b) => shuffleKey(a.key) - shuffleKey(b.key)).slice(0, ROW_SIZE),
      psFree: psItems.filter((i) => i.ps?.freeToPlay).slice(0, ROW_SIZE),
    }
  }, [psItems, xboxItems, recentKeys])

  // The first thing seen should already be a game, not an empty stage.
  const first = rows.recent[0] ?? rows.xboxPlay.find((i) => i.hero) ?? rows.xboxPlay[0] ?? rows.psPlay[0]
  useEffect(() => {
    if (first && !spotlight) setSpotlight(first)
  }, [first, spotlight])

  const hero = spotlight ?? first
  const scroller = useRef<HTMLDivElement>(null)

  return (
    <div className="home" ref={scroller}>
      <section className="hero">
        {hero?.art && !hero.hero && <img key={hero.art} className="hero-art" src={hero.art} alt="" draggable={false} />}
        {hero ? (
          <div className="hero-copy" key={hero.key}>
            <span className={`hero-service hero-service--${hero.service}`}>{serviceLabel(hero.service)}</span>
            <h1>{hero.name}</h1>
            <p>{hero.subtitle}</p>
            <button className="primary big" data-nav disabled={hero.action === 'none' || (hero.action === 'play' && !canStart(hero, psPremium))} onClick={() => onPlay(hero, null)}>
              {hero.action === 'store' ? 'Mağazada aç' : hero.action === 'none' ? 'Bulutta yok' : canStart(hero, psPremium) ? 'Oyna' : 'PS Plus Premium gerekiyor'}
            </button>
            <button className="ghost big" data-nav onClick={() => onOpen(hero, null)}>Detaylar</button>
          </div>
        ) : (
          <div className="hero-copy">
            <h1>Hoş geldin</h1>
            <p>Tüm oyunların tek yerde. Başlamak için hesaplarını bağla.</p>
          </div>
        )}
      </section>

      {running && (
        <div className="resume glass" role="status">
          <span>Devam eden Xbox oturumun var{runningItem ? <>: <strong>{runningItem.name}</strong></> : ''}</span>
          {runningItem && <button className="primary" data-nav onClick={() => { clearXboxRunning(); onResume(runningItem, running.id) }}>Devam et</button>}
          <button className="ghost" data-nav onClick={() => { clearXboxRunning(); void window.hc.xbox.endSession(running.id, running.titleId) }}>Kapat</button>
        </div>
      )}

      <div className="space-cards">
        <SpaceCard space="playstation" title="PlayStation" detail={ps.state === 'signedIn' ? `${psItems.length.toLocaleString('tr')} oyun` : 'Hesabını bağla'} onGo={onGo} />
        <SpaceCard space="xbox" title="Xbox" detail={xbox.state === 'signedIn' ? `${xboxItems.length.toLocaleString('tr')} oyun` : 'Hesabını bağla'} onGo={onGo} />
        <SpaceCard space="settings" title="Ayarlar" detail="Görüntü, ses, kol" onGo={onGo} />
      </div>

      {rows.recent.length > 0 && <Row title="Son oynadıkların">{rows.recent.map((i) => <GameTile key={i.key} item={i} onOpen={onOpen} showService />)}</Row>}
      {rows.xboxPlay.length > 0 && <Row title="Xbox · Sahip olduklarım" onAll={() => onGo('xbox')}>{rows.xboxPlay.map((i) => <GameTile key={i.key} item={i} onOpen={onOpen} />)}</Row>}
      {rows.psPlay.length > 0 && <Row title="PlayStation kataloğu" onAll={() => onGo('playstation')}>{rows.psPlay.map((i) => <GameTile key={i.key} item={i} onOpen={onOpen} />)}</Row>}
      {rows.psFree.length > 0 && <Row title="Ücretsiz PlayStation oyunları" onAll={() => onGo('playstation')}>{rows.psFree.map((i) => <GameTile key={i.key} item={i} onOpen={onOpen} />)}</Row>}
    </div>
  )
}
