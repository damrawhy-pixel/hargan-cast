import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { getSettings } from '../lib/useSettings'

export interface StreamStats {
  fps: number
  mbps: number
  lost: number
  size?: string
  rttMs?: number
  decodeMs?: number
}

export interface StreamQueue {
  position?: number
  seconds?: number
}

interface Props {
  title: string
  stage: string
  live: boolean
  stats?: StreamStats
  queue?: StreamQueue
  controller?: string
  image?: string
  onExit(): void
  children: ReactNode
}

const HIDE_CURSOR_MS = 2500
const MENU_HOLD_MS = 900
const PAD_VIEW = 8
const PAD_MENU = 9
const PAD_A = 0
const PAD_B = 1
const PAD_UP = 12
const PAD_DOWN = 13

const FIT = { Stretch: 'fill', Zoom: 'cover' } as Record<string, string>

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

function QueueCard({ queue }: { queue: StreamQueue }) {
  const [waited, setWaited] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const timer = setInterval(() => setWaited(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])

  const left = queue.seconds === undefined ? undefined : queue.seconds - waited
  return (
    <div className="queue" role="status">
      <span>Sıradasın</span>
      {queue.position !== undefined && <b>{queue.position}. sıra</b>}
      {left !== undefined && <b>{left > 0 ? `Yaklaşık ${clock(left)}` : 'Az kaldı'}</b>}
      <small>{clock(waited)} bekledin. Sıra gelince oyun kendiliğinden açılır.</small>
    </div>
  )
}

export function StreamShell({ title, stage, live, stats, queue, controller, image, onExit, children }: Props) {
  const settings = getSettings()
  const ratio = settings.videoFormat.includes(':') ? settings.videoFormat.replace(':', ' / ') : undefined
  // Any CSS filter, even a neutral one, keeps video off the GPU's direct path to the screen.
  const adjusted = settings.brightness !== 100 || settings.contrast !== 100 || settings.saturation !== 100
  const pictureStyle = {
    '--stream-fit': FIT[settings.videoFormat] ?? 'contain',
    '--stream-ratio': ratio ?? 'auto',
    filter: adjusted ? `brightness(${settings.brightness}%) contrast(${settings.contrast}%) saturate(${settings.saturation}%)` : undefined,
  } as CSSProperties

  const [menu, setMenu] = useState(false)
  const [showStats, setShowStats] = useState(() => getSettings().showStats)
  const [idle, setIdle] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') setMenu((m) => !m)
      if (e.code === 'F3') {
        e.preventDefault()
        setShowStats((s) => !s)
      }
    }
    window.addEventListener('keydown', onKey)
    const fullscreen = getSettings().fullscreenOnStream
    if (fullscreen) window.hc.platform.fullscreen(true)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (fullscreen) window.hc.platform.fullscreen(false)
    }
  }, [])

  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    menuRef.current?.querySelector('button')?.focus()
  }, [menu])

  // View + Menu held together is the one way out that needs no keyboard.
  useEffect(() => {
    let frame = 0
    let heldSince = 0
    let fired = false
    const was: Record<number, boolean> = {}

    const pressedNow = (pad: Gamepad, index: number) => {
      const down = pad.buttons[index]?.pressed ?? false
      const rising = down && !was[index]
      was[index] = down
      return rising
    }

    const poll = () => {
      frame = requestAnimationFrame(poll)
      const pad = navigator.getGamepads().find((p) => p?.connected)
      if (!pad) return

      const combo = Boolean(pad.buttons[PAD_VIEW]?.pressed && pad.buttons[PAD_MENU]?.pressed)
      const now = performance.now()
      if (!combo) {
        heldSince = 0
        fired = false
      } else if (!heldSince) heldSince = now
      else if (!fired && now - heldSince >= MENU_HOLD_MS) {
        fired = true
        setMenu((m) => !m)
      }

      const buttons = [...(menuRef.current?.querySelectorAll('button') ?? [])]
      const up = pressedNow(pad, PAD_UP)
      const down = pressedNow(pad, PAD_DOWN)
      const confirm = pressedNow(pad, PAD_A)
      const back = pressedNow(pad, PAD_B)
      if (!buttons.length) return

      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (up) buttons[(index - 1 + buttons.length) % buttons.length].focus()
      if (down) buttons[(index + 1) % buttons.length].focus()
      if (confirm) buttons[Math.max(index, 0)].click()
      if (back) setMenu(false)
    }
    frame = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(frame)
  }, [])

  const onMove = () => {
    setIdle(false)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), HIDE_CURSOR_MS)
  }

  return (
    <div
      className={`stream ${idle && !menu && settings.hideCursor ? 'stream--idle' : ''}`}
      onMouseMove={onMove}
      onDoubleClick={() => settings.doubleClickFullscreen && window.hc.platform.toggleFullscreen()}
    >
      <div className={`stream-picture ${ratio ? 'stream-picture--ratio' : ''}`} style={pictureStyle}>{children}</div>

      {!live && (
        <div className="stream-veil" style={image && settings.showGameImage ? { backgroundImage: `linear-gradient(rgba(6, 7, 10, 0.72), rgba(6, 7, 10, 0.9)), url("${image}")` } : undefined}>
          {image && <img className="launch-art" src={image} alt="" />}
          <h2>{title}</h2>
          <div className="launch-bar" aria-hidden="true"><span /></div>
          {queue ? <QueueCard queue={queue} /> : <p>{stage}</p>}
          <button className="ghost" onClick={onExit}>Vazgeç</button>
        </div>
      )}

      {showStats && stats && (
        <div className={`stream-stats ${settings.statsVertical ? 'stream-stats--vertical' : ''}`}>
          <b>{stats.fps}</b> kare/sn · <b>{stats.mbps.toFixed(1)}</b> Mb/sn · kayıp <b>{stats.lost}</b>
          {stats.rttMs !== undefined && <> · gecikme <b>{stats.rttMs}</b> ms</>}
          {stats.decodeMs !== undefined && <> · çözme <b>{stats.decodeMs.toFixed(1)}</b> ms</>}
          {stats.size && <> · {stats.size}</>}
          {controller && <> · {controller}</>}
        </div>
      )}

      {menu && (
        <div className="stream-menu" role="dialog" aria-label="Akış menüsü" ref={menuRef}>
          <h3>{title}</h3>
          <button className="primary" onClick={() => setMenu(false)}>Oyuna dön</button>
          <button className="ghost" onClick={() => setShowStats((s) => !s)}>{showStats ? 'İstatistikleri gizle' : 'İstatistikleri göster'}</button>
          <button className="ghost danger" onClick={onExit}>Akışı bitir</button>
          <small>Kolda View + Menu düğmelerini basılı tutarak açılır.</small>
        </div>
      )}
    </div>
  )
}
