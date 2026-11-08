import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { GameInfo } from '../../../shared/types'
import { gameInfo, imageAt, knownInfo, ratingText } from '../lib/gameInfo'
import { canStart, serviceLabel, type HubItem } from '../lib/items'
import { clearXboxRunning, setSpotlight, useStore } from '../lib/store'
import { useSettings } from '../lib/useSettings'
import { GameTile } from './GameTile'
import { ShotViewer } from './ShotViewer'
import type { Space } from './TopBar'

const LAUNCHER_SIZE = 12
const ROW_SIZE = 18
const HUB_DWELL_MS = 1200
const HUB_SHOTS = 8
const SHOT_WIDTH = 560
const LOGO_WIDTH = 900
const HERO_WIDTH = 1920

interface Props {
  onOpen(item: HubItem, art: HTMLElement | null): void
  onPlay(item: HubItem, art: HTMLElement | null): void
  onGo(space: Space): void
  onResume(item: HubItem, sessionId: string): void
}

function Shelf({ title, onAll, children }: { title: string; onAll?(): void; children: ReactNode }) {
  return (
    <section className="shelf">
      <header className="shelf-head">
        <h2>{title}</h2>
        {onAll && <button className="shelf-all" onClick={onAll}>Tümü</button>}
      </header>
      <div className="rail">{children}</div>
    </section>
  )
}

const shuffleKey = (key: string) => [...key].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 7)

function LaunchTile({ item, selected, onSelect, onActivate }: { item: HubItem; selected: boolean; onSelect(): void; onActivate(art: HTMLElement | null): void }) {
  const art = item.icon ?? item.art
  return (
    <button
      className="launch-tile"
      data-nav
      data-launcher
      data-service={item.service}
      aria-selected={selected}
      onFocus={onSelect}
      // Layout shifts slide tiles under a resting cursor; only a mouse in use may select.
      onMouseEnter={() => document.documentElement.dataset.input !== 'pad' && onSelect()}
      onClick={(e) => onActivate(e.currentTarget.querySelector('img'))}
    >
      <span className="launch-icon" data-anchor>{art ? <img src={art} alt="" draggable={false} /> : <span className="tile-fallback">{item.name}</span>}</span>
      <span className="launch-name">{item.name}</span>
    </button>
  )
}

function LibraryTile({ space, label, count, onGo }: { space: Space; label: string; count?: number; onGo(space: Space): void }) {
  return (
    <button className={`launch-tile launch-tile--library launch-tile--${space}`} data-nav data-launcher onClick={() => onGo(space)}>
      <span className="launch-icon" data-anchor>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h4v14H4zM10 5h4v14h-4zM16.2 5.6l3.8-1 3 13.5-3.8 1z" />
        </svg>
      </span>
      <span className="launch-name">
        {label}
        {count !== undefined && <small>{count.toLocaleString('tr')} oyun</small>}
      </span>
    </button>
  )
}

export function Home({ onOpen, onPlay, onGo, onResume }: Props) {
  const psItems = useStore((s) => s.psItems)
  const xboxItems = useStore((s) => s.xboxItems)
  const ps = useStore((s) => s.ps)
  const xbox = useStore((s) => s.xbox)
  const recentKeys = useStore((s) => s.recents)
  const running = useStore((s) => s.xboxRunning)
  const { psPremium } = useSettings()
  const runningItem = running && xboxItems.find((i) => i.xbox?.titleId === running.titleId)

  const rows = useMemo(() => {
    const byKey = new Map([...psItems, ...xboxItems].map((i) => [i.key, i]))
    const lastPlayed = (i: HubItem) => i.xbox?.lastPlayed ?? ''
    const recent = recentKeys.map((k) => byKey.get(k)).filter((i): i is HubItem => Boolean(i))
    const xboxPlay = xboxItems.filter((i) => i.action === 'play').sort((a, b) => lastPlayed(b).localeCompare(lastPlayed(a)))
    const psPlay = psItems.filter((i) => i.action === 'play' && (psPremium || i.ps?.isOwned)).sort((a, b) => shuffleKey(a.key) - shuffleKey(b.key))
    // The launcher is the console's row of recent games: what was played, then what can be.
    const seen = new Set<string>()
    const launcher = [...recent, ...xboxPlay.filter((i) => i.xbox?.lastPlayed), ...psPlay, ...xboxPlay]
      .filter((i) => !seen.has(i.key) && seen.add(i.key))
      .slice(0, LAUNCHER_SIZE)
    return {
      launcher,
      recent,
      xboxPlay: xboxPlay.slice(0, ROW_SIZE),
      psPlay: psItems.filter((i) => i.action === 'play').sort((a, b) => shuffleKey(a.key) - shuffleKey(b.key)).slice(0, ROW_SIZE),
      psFree: psItems.filter((i) => i.ps?.freeToPlay).slice(0, ROW_SIZE),
    }
  }, [psItems, xboxItems, recentKeys, psPremium])

  const [selectedKey, setSelectedKey] = useState<string>()
  const selected = rows.launcher.find((i) => i.key === selectedKey) ?? rows.launcher[0]
  // A game without wide art gets the store's key art once its page has arrived.
  const withArt = (item: HubItem, info?: GameInfo) => (item.hero || !info?.hero ? item : { ...item, hero: imageAt(info.hero, HERO_WIDTH) })
  useEffect(() => {
    if (selected) setSpotlight(withArt(selected, knownInfo(selected)))
  }, [selected])

  // The page under the game arrives only once the eye has settled on it, as on a console.
  const [hub, setHub] = useState<{ key: string; info: GameInfo }>()
  const [viewer, setViewer] = useState<{ shots: string[]; start: number }>()
  useEffect(() => {
    if (!selected) return
    let stale = false
    const settled = new Promise((done) => setTimeout(done, HUB_DWELL_MS))
    void Promise.all([gameInfo(selected), settled]).then(([info]) => {
      if (stale || !info) return
      setHub({ key: selected.key, info })
      setSpotlight(withArt(selected, info))
    })
    return () => {
      stale = true
    }
  }, [selected])
  const shown = hub && hub.key === selected?.key ? hub.info : undefined
  // A logo already fetched shows at once; a new one replaces the title when it arrives.
  const logo = selected && (shown ?? knownInfo(selected))?.logo

  const opener = useRef<HTMLElement | null>(null)
  const openViewer = (shots: string[], start: number, from: HTMLElement) => {
    opener.current = from
    setViewer({ shots, start })
  }
  const closeViewer = useCallback(() => {
    setViewer(undefined)
    requestAnimationFrame(() => opener.current?.focus())
  }, [])

  const startable = selected ? canStart(selected, psPremium) : false
  const activate = (item: HubItem, art: HTMLElement | null) => {
    // As on a console: confirm on a game starts it; one that cannot start shows its page.
    if (canStart(item, psPremium)) onPlay(item, art)
    else onOpen(item, art)
  }

  return (
    <div className="home">
      <section className="launch">
        <div className="launcher" role="listbox" aria-label="Oyunlar">
          {rows.launcher.map((item) => (
            <LaunchTile key={item.key} item={item} selected={item.key === selected?.key} onSelect={() => setSelectedKey(item.key)} onActivate={(art) => activate(item, art)} />
          ))}
          {ps.state === 'signedIn' && <LibraryTile space="playstation" label="PlayStation kitaplığı" count={psItems.length} onGo={onGo} />}
          {xbox.state === 'signedIn' && <LibraryTile space="xbox" label="Xbox kitaplığı" count={xboxItems.length} onGo={onGo} />}
          {ps.state !== 'signedIn' && xbox.state !== 'signedIn' && <LibraryTile space="settings" label="Hesap bağla" onGo={onGo} />}
        </div>

        {selected ? (
          <div className="launch-info">
            {/* Only the text re-enters on a new game; the buttons stay put so focus survives. */}
            <div className="launch-copy" key={selected.key}>
              {/* Brand names keep the English capitals; Turkish rules would print PLAYSTATİON. */}
              <span className={`launch-service launch-service--${selected.service}`} lang="en">{serviceLabel(selected.service)}</span>
              {logo ? <img key={logo} className="launch-logo" src={imageAt(logo, LOGO_WIDTH)} alt={selected.name} draggable={false} /> : <h1>{selected.name}</h1>}
              <p>{selected.subtitle}</p>
            </div>
            <div className="launch-actions">
              {selected.action === 'store' ? (
                <button className="launch-play" data-nav onClick={() => onPlay(selected, null)}>Mağazada aç</button>
              ) : startable ? (
                <button className="launch-play" data-nav onClick={() => onPlay(selected, null)}>Oyna</button>
              ) : (
                <button className="launch-play launch-play--muted" data-nav onClick={() => onOpen(selected, null)}>
                  {selected.action === 'none' ? 'Bulutta yok' : 'PS Plus Premium gerekiyor'}
                </button>
              )}
              <button className="round-button round-button--big" data-nav aria-label="Oyun bilgisi" title="Oyun bilgisi" onClick={() => onOpen(selected, null)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
              </button>
            </div>
          </div>
        ) : (
          <div className="launch-info">
            <h1>Hoş geldin</h1>
            <p>PlayStation ve Xbox oyunların tek yerde. Başlamak için hesaplarını bağla.</p>
            <div className="launch-actions">
              <button className="launch-play" data-nav onClick={() => onGo('playstation')}>PlayStation'a bağlan</button>
              <button className="launch-play launch-play--muted" data-nav onClick={() => onGo('xbox')}>Xbox'a bağlan</button>
            </div>
          </div>
        )}

        <div className={`hub ${shown ? 'hub--in' : ''}`} aria-hidden={!shown}>
          {shown && selected && (
            <div className="hub-row" key={selected.key}>
              <button className="hub-card hub-about" data-nav onClick={() => onOpen(selected, null)}>
                <strong>Oyun hakkında</strong>
                {shown.community && <span className="hub-rating">{ratingText(shown.community)}</span>}
                <p>{shown.description || selected.subtitle}</p>
              </button>
              {shown.screenshots.slice(0, HUB_SHOTS).map((url, i) => (
                <button key={url} className="hub-card hub-shot" data-nav aria-label={`Ekran görüntüsü ${i + 1}`} onClick={(e) => openViewer(shown.screenshots, i, e.currentTarget)}>
                  <img src={imageAt(url, SHOT_WIDTH)} alt="" loading="lazy" decoding="async" draggable={false} />
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {viewer && selected && <ShotViewer title={selected.name} shots={viewer.shots} start={viewer.start} onClose={closeViewer} />}

      {running && (
        <div className="resume" role="status">
          <span>Devam eden Xbox oturumun var{runningItem ? <>: <strong>{runningItem.name}</strong></> : ''}</span>
          {runningItem && <button className="launch-play" data-nav onClick={() => { clearXboxRunning(); onResume(runningItem, running.id) }}>Devam et</button>}
          <button className="ghost" data-nav onClick={() => { clearXboxRunning(); void window.hc.xbox.endSession(running.id, running.titleId) }}>Kapat</button>
        </div>
      )}

      <div className="shelves">
        {rows.recent.length > 0 && <Shelf title="Son oynadıkların">{rows.recent.map((i) => <GameTile key={i.key} item={i} onOpen={onOpen} showService />)}</Shelf>}
        {rows.xboxPlay.length > 0 && <Shelf title="Xbox · Oynayabileceklerin" onAll={() => onGo('xbox')}>{rows.xboxPlay.map((i) => <GameTile key={i.key} item={i} onOpen={onOpen} />)}</Shelf>}
        {rows.psPlay.length > 0 && <Shelf title="PlayStation akış kataloğu" onAll={() => onGo('playstation')}>{rows.psPlay.map((i) => <GameTile key={i.key} item={i} onOpen={onOpen} />)}</Shelf>}
        {rows.psFree.length > 0 && <Shelf title="Ücretsiz PlayStation oyunları" onAll={() => onGo('playstation')}>{rows.psFree.map((i) => <GameTile key={i.key} item={i} onOpen={onOpen} />)}</Shelf>}
      </div>
    </div>
  )
}
