import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { About } from './components/About'
import { Backdrop } from './components/Backdrop'
import { GameDetail } from './components/GameDetail'
import { Home } from './components/Home'
import { SettingsPage } from './components/SettingsPage'
import { Splash } from './components/Splash'
import { SPACES, TopBar, type Space } from './components/TopBar'
import { canStart, type HubItem } from './lib/items'
import { reducedMotion, useMotionSetting } from './lib/motion'
import { readSetting, writeSetting } from './lib/settings'
import { useSpatialNavigation } from './lib/spatialNavigation'
import { rememberPlayed, useStore } from './lib/store'
import { getSettings } from './lib/useSettings'
import { PlayStationSpace } from './playstation/PlayStationSpace'
import { XboxSpace, consoleTitle } from './xbox/XboxSpace'
import { t } from '../../shared/i18n'
import type { PsConsole, XboxTitle } from '../../shared/types'

const PsStream = lazy(() => import('./playstation/PsStream').then((m) => ({ default: m.PsStream })))
const XboxStream = lazy(() => import('./xbox/XboxStream').then((m) => ({ default: m.XboxStream })))

const TOAST_MS = 4500
// How long a shortcut's game may take to appear while the libraries load.
const LAUNCH_WAIT_MS = 60_000
const ORDER = SPACES.map(([id]) => id)

// Shared-element morphs where the browser supports them, plain state otherwise.
function transition(update: () => void) {
  if (!document.startViewTransition || reducedMotion()) return update()
  document.startViewTransition(() => flushSync(update))
}

export function App() {
  const [space, setSpace] = useState<Space>(() => readSetting<Space>('space', 'home'))
  const [stream, setStream] = useState<HubItem>()
  // A Remote Play stream from the user's own console, instead of a game.
  const [remote, setRemote] = useState<PsConsole>()
  // The same for an Xbox: its own console, streamed through Microsoft.
  const [homeXbox, setHomeXbox] = useState<XboxTitle>()
  const playing = Boolean(stream || remote || homeXbox)
  const [resumeId, setResumeId] = useState<string>()
  const [toast, setToast] = useState<string>()
  const [about, setAbout] = useState(false)
  const [detail, setDetail] = useState<HubItem>()
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => writeSetting('space', space), [space])
  useMotionSetting()

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

  const [splash, setSplash] = useState<'showing' | 'revealing' | 'gone'>('showing')
  const reveal = useCallback(() => setSplash('revealing'), [])
  const splashDone = useCallback(() => setSplash('gone'), [])

  const home = useCallback(() => go('home'), [go])
  useSpatialNavigation(!playing && splash === 'gone', step, home)

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
        showToast(item.xbox?.cloud ? t('Bu oyun hesabınla bulutta açılmıyor.') : t('Bu oyun Cloud Gaming kataloğunda yok.'))
        return
      }
      if (!canStart(item, getSettings().psPremium)) {
        showToast(t('Bu oyun için PS Plus Premium gerekiyor. Aboneliğin varsa Ayarlar > PlayStation kısmından aç.'))
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

  const playConsole = useCallback((target: PsConsole) => transition(() => setRemote(target)), [])
  const playXboxConsole = useCallback((target: XboxTitle) => transition(() => setHomeXbox(target)), [])

  const finish = (error?: string) => {
    transition(() => {
      setStream(undefined)
      setRemote(undefined)
      setHomeXbox(undefined)
    })
    if (error) {
      window.hc.platform.log?.(`stream ended: ${error}`)
      showToast(error)
    }
  }

  // A game or console named by a shortcut, a Steam entry or a hargancast:// link.
  const [launch, setLaunch] = useState<string>()
  useEffect(() => {
    void window.hc.platform.takeLaunch?.().then((target) => target && setLaunch(target))
    return window.hc.platform.onLaunch?.(setLaunch)
  }, [])
  const psItems = useStore((s) => s.psItems)
  const xboxItems = useStore((s) => s.xboxItems)
  useEffect(() => {
    if (!launch || splash !== 'gone' || playing) return
    if (launch.startsWith('console:')) {
      setLaunch(undefined)
      const rest = launch.slice('console:'.length)
      const id = rest.slice(rest.indexOf(':') + 1)
      const missing = () => showToast(t('Konsol bulunamadı.'))
      if (rest.startsWith('ps:'))
        void window.hc.ps.consoles?.list().then((list) => {
          const found = list.find((c) => c.id === id)
          if (found) playConsole(found)
          else missing()
        })
      else
        void window.hc.xbox.consoles().then((list) => {
          const found = list.find((c) => c.serverId === id)
          if (found) playXboxConsole(consoleTitle(found))
          else missing()
        })
      return
    }
    const item = [...psItems, ...xboxItems].find((i) => i.key === launch)
    if (item) {
      setLaunch(undefined)
      play(item, null)
      return
    }
    // The libraries load after start; give up if the game never turns up.
    const timer = setTimeout(() => {
      setLaunch(undefined)
      showToast(t('Kısayoldaki oyun kütüphanende bulunamadı.'))
    }, LAUNCH_WAIT_MS)
    return () => clearTimeout(timer)
  }, [launch, splash, playing, psItems, xboxItems, play, playConsole, playXboxConsole, showToast])

  return (
    <div className="app" data-space={space} data-direction={direction} data-splash={splash === 'gone' ? undefined : splash}>
      <Backdrop hidden={playing} />

      {!playing && <TopBar space={space} onSelect={go} onAbout={() => setAbout(true)} />}

      {/* All stay mounted so switching is instant; `hidden` stops their paint cost. */}
      <main className="space" data-theme="home" hidden={space !== 'home' || playing}>
        <Home onOpen={showDetail} onPlay={play} onGo={go} onResume={resume} />
      </main>
      <main className="space" data-theme="playstation" hidden={space !== 'playstation' || playing}>
        <PlayStationSpace onOpen={showDetail} onPlayConsole={playConsole} />
      </main>
      <main className="space" data-theme="xbox" hidden={space !== 'xbox' || playing}>
        <XboxSpace onOpen={showDetail} onOpenSettings={() => go('settings')} onPlayConsole={playXboxConsole} />
      </main>
      <main className="space" data-theme="settings" hidden={space !== 'settings' || playing}>
        <SettingsPage active={space === 'settings' && !playing} onAbout={() => setAbout(true)} />
      </main>

      {detail && !playing && (
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

      {splash !== 'gone' && <Splash onReveal={reveal} onDone={splashDone} />}

      {toast && <div className="toast glass" role="status">{toast}</div>}
      {about && <About onClose={() => setAbout(false)} />}

      {remote && (
        <Suspense fallback={null}>
          <PsStream console={remote} onExit={finish} />
        </Suspense>
      )}
      {homeXbox && (
        <Suspense fallback={null}>
          <XboxStream title={homeXbox} onExit={finish} />
        </Suspense>
      )}
      {stream && !remote && !homeXbox && (
        <Suspense fallback={null}>
          {stream.ps
            ? <PsStream game={stream.ps} onExit={finish} />
            : <XboxStream title={stream.xbox!} resumeId={resumeId} onExit={finish} />}
        </Suspense>
      )}
    </div>
  )
}
