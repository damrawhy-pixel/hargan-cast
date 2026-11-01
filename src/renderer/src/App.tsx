import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { About } from './components/About'
import { Backdrop } from './components/Backdrop'
import { GameDetail } from './components/GameDetail'
import { Home } from './components/Home'
import { SettingsPage } from './components/SettingsPage'
import { SPACES, TopBar, type Space } from './components/TopBar'
import { canStart, type HubItem } from './lib/items'
import { readSetting, writeSetting } from './lib/settings'
import { useSpatialNavigation } from './lib/spatialNavigation'
import { rememberPlayed } from './lib/store'
import { getSettings } from './lib/useSettings'
import { PlayStationSpace } from './playstation/PlayStationSpace'
import { XboxSpace } from './xbox/XboxSpace'

const PsStream = lazy(() => import('./playstation/PsStream').then((m) => ({ default: m.PsStream })))
const XboxStream = lazy(() => import('./xbox/XboxStream').then((m) => ({ default: m.XboxStream })))

const TOAST_MS = 4500
const ORDER = SPACES.map(([id]) => id)

// Shared-element morphs where the browser supports them, plain state otherwise.
function transition(update: () => void) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return update()
  document.startViewTransition(() => flushSync(update))
}

export function App() {
  const [space, setSpace] = useState<Space>(() => readSetting<Space>('space', 'home'))
  const [stream, setStream] = useState<HubItem>()
  const [resumeId, setResumeId] = useState<string>()
  const [toast, setToast] = useState<string>()
  const [about, setAbout] = useState(false)
  const [detail, setDetail] = useState<HubItem>()
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => writeSetting('space', space), [space])

  const showToast = useCallback((text: string) => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(undefined), TOAST_MS)
  }, [])

  const go = useCallback((next: Space) => {
    setSpace((current) => {
      setDirection(ORDER.indexOf(next) >= ORDER.indexOf(current) ? 'forward' : 'back')
      return next
    })
  }, [])

  const step = useCallback((by: 1 | -1) => {
    setSpace((current) => {
      setDirection(by > 0 ? 'forward' : 'back')
      return ORDER[(ORDER.indexOf(current) + by + ORDER.length) % ORDER.length]
    })
  }, [])

  useSpatialNavigation(!stream, step)

  const showDetail = useCallback((item: HubItem, art: HTMLElement | null) => {
    if (art) art.style.viewTransitionName = 'game-art'
    transition(() => {
      if (art) art.style.viewTransitionName = ''
      setDetail(item)
    })
  }, [])

  const closeDetail = useCallback(() => transition(() => setDetail(undefined)), [])

  const play = useCallback(
    (item: HubItem, art: HTMLElement | null) => {
      if (item.action === 'store') {
        if (item.storeUrl) window.hc.platform.openExternal(item.storeUrl)
        return
      }
      if (item.action === 'none') {
        showToast(item.xbox?.cloud ? 'Bu oyun hesabınla bulutta açılmıyor.' : 'Bu oyun Cloud Gaming kataloğunda yok.')
        return
      }
      if (!canStart(item, getSettings().psPremium)) {
        showToast('Bu oyun için PS Plus Premium gerekiyor. Aboneliğin varsa Ayarlar > PlayStation kısmından aç.')
        return
      }
      rememberPlayed(item)
      setResumeId(undefined)
      if (art) art.style.viewTransitionName = 'launch-art'
      transition(() => {
        if (art) art.style.viewTransitionName = ''
        setDetail(undefined)
        setStream(item)
      })
    },
    [showToast],
  )

  const resume = useCallback((item: HubItem, sessionId: string) => {
    setResumeId(sessionId)
    transition(() => setStream(item))
  }, [])

  const finish = (error?: string) => {
    transition(() => setStream(undefined))
    if (error) showToast(error)
  }

  return (
    <div className="app" data-space={space} data-direction={direction}>
      <Backdrop hidden={Boolean(stream)} />

      {!stream && <TopBar space={space} onSelect={go} onAbout={() => setAbout(true)} />}

      {/* All stay mounted so switching is instant; `hidden` stops their paint cost. */}
      <main className="space" data-theme="home" hidden={space !== 'home' || Boolean(stream)}>
        <Home onOpen={showDetail} onPlay={play} onGo={go} onResume={resume} />
      </main>
      <main className="space" data-theme="playstation" hidden={space !== 'playstation' || Boolean(stream)}>
        <PlayStationSpace onOpen={showDetail} />
      </main>
      <main className="space" data-theme="xbox" hidden={space !== 'xbox' || Boolean(stream)}>
        <XboxSpace onOpen={showDetail} onOpenSettings={() => go('settings')} />
      </main>
      <main className="space" data-theme="settings" hidden={space !== 'settings' || Boolean(stream)}>
        <SettingsPage active={space === 'settings' && !stream} onAbout={() => setAbout(true)} />
      </main>

      {detail && !stream && (
        <GameDetail
          item={detail}
          onClose={closeDetail}
          onPlay={play}
          onOpenSettings={() => {
            setDetail(undefined)
            go('settings')
          }}
        />
      )}

      {toast && <div className="toast glass" role="status">{toast}</div>}
      {about && <About onClose={() => setAbout(false)} />}

      {stream && (
        <Suspense fallback={null}>
          {stream.ps
            ? <PsStream game={stream.ps} onExit={finish} />
            : <XboxStream title={stream.xbox!} resumeId={resumeId} onExit={finish} />}
        </Suspense>
      )}
    </div>
  )
}
