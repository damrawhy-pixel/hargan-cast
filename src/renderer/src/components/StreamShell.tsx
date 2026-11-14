import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { MOBILE } from '../lib/platform'
import { connectedPads } from '../lib/gamepads'
import { getSettings } from '../lib/useSettings'
import { settingsFor } from '../../../shared/settings'
import { physicalPads } from '../lib/virtualPad'
import { TouchControls, type TouchPlatform } from './TouchControls'
import { t } from '../../../shared/i18n'

export interface StreamStats {
  fps: number
  mbps: number
  lost: number
  size?: string
  rttMs?: number
  decodeMs?: number
  /** Variation in frame arrival, ms. */
  jitterMs?: number
  /** Frames dropped to catch up, since the start. */
  skipped?: number
}

export interface StreamQueue {
  position?: number
  seconds?: number
}

interface Props {
  platform: TouchPlatform
  /** The game's key, for its own picture settings. */
  profileKey: string
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
      <span>{t('Sıradasın')}</span>
      {queue.position !== undefined && <b>{t('{n}. sıra', { n: queue.position })}</b>}
      {left !== undefined && <b>{left > 0 ? t('Yaklaşık {time}', { time: clock(left) }) : t('Az kaldı')}</b>}
      <small>{t('{time} bekledin. Sıra gelince oyun kendiliğinden açılır.', { time: clock(waited) })}</small>
    </div>
  )
}

// Phones and tablets only. On 'auto' the controls step aside once a real controller
// has been used; browsers only report one after its first button press.
function useTouchControls() {
  const mode = getSettings().touchControls
  const watch = MOBILE && mode === 'auto'
  const [padInUse, setPadInUse] = useState(() => watch && physicalPads().length > 0)
  useEffect(() => {
    if (!watch) return
    const check = () => setPadInUse(physicalPads().length > 0)
    const timer = setInterval(check, 1000)
    window.addEventListener('gamepadconnected', check)
    window.addEventListener('gamepaddisconnected', check)
    return () => {
      clearInterval(timer)
      window.removeEventListener('gamepadconnected', check)
      window.removeEventListener('gamepaddisconnected', check)
    }
  }, [watch])
  return MOBILE && (mode === 'on' || (mode === 'auto' && !padInUse))
}

// One line per stream in the log (time to picture, frame rate, bit rate, loss,
// latency), so "it stuttered yesterday" can be looked up afterwards.
function useSessionReport(platform: string, title: string, live: boolean, stats?: StreamStats) {
  const started = useRef(Date.now())
  const totals = useRef({ samples: 0, fps: 0, minFps: Infinity, mbps: 0, rtt: 0, rttSamples: 0, decode: 0, decodeSamples: 0, jitter: 0, jitterSamples: 0, skipped: 0, lost: 0, size: '', liveAt: 0 })

  useEffect(() => {
    if (live && !totals.current.liveAt) totals.current.liveAt = Date.now()
  }, [live])

  useEffect(() => {
    if (!stats || !live) return
    const t = totals.current
    t.samples++
    t.fps += stats.fps
    t.minFps = Math.min(t.minFps, stats.fps)
    t.mbps += stats.mbps
    if (stats.rttMs !== undefined) {
      t.rtt += stats.rttMs
      t.rttSamples++
    }
    if (stats.decodeMs !== undefined) {
      t.decode += stats.decodeMs
      t.decodeSamples++
    }
    if (stats.jitterMs !== undefined) {
      t.jitter += stats.jitterMs
      t.jitterSamples++
    }
    t.skipped = Math.max(t.skipped, stats.skipped ?? 0)
    t.lost = Math.max(t.lost, stats.lost)
    if (stats.size) t.size = stats.size
  }, [stats, live])

  useEffect(
    () => () => {
      const t = totals.current
      const avg = (sum: number, n: number) => (n ? (sum / n).toFixed(1) : '-')
      const seconds = Math.round((Date.now() - started.current) / 1000)
      const toPicture = t.liveAt ? `${((t.liveAt - started.current) / 1000).toFixed(1)} s` : 'never'
      window.hc.platform.log?.(
        `stream ${platform} "${title}": ${seconds} s, picture after ${toPicture}, fps avg ${avg(t.fps, t.samples)} min ${t.samples ? t.minFps : '-'}, ` +
          `${avg(t.mbps, t.samples)} Mb/s, lost ${t.lost}, rtt ${avg(t.rtt, t.rttSamples)} ms, decode ${avg(t.decode, t.decodeSamples)} ms, jitter ${avg(t.jitter, t.jitterSamples)} ms, skipped ${t.skipped}, ${t.size || '-'}`,
      )
    },
    [platform, title],
  )
}

// The services lower the stream's resolution on their own when the network
// struggles; say so for a moment, since the picture just gets softer otherwise.
const NOTICE_MS = 6000
const DROP_SHARE = 0.85

function useResolutionNotice(live: boolean, size?: string) {
  const [notice, setNotice] = useState<string>()
  const best = useRef(0)
  const dropped = useRef(false)
  useEffect(() => {
    const height = Number(size?.match(/^\d+×(\d+)/)?.[1] ?? 0)
    if (!live || !height) return
    if (height > best.current) best.current = height
    if (height < best.current * DROP_SHARE) {
      if (dropped.current) return
      dropped.current = true
      setNotice(t('Sunucu görüntüyü {h}p çözünürlüğe düşürdü; ağ yavaşladığında olur.', { h: height }))
    } else if (dropped.current && height >= best.current) {
      dropped.current = false
      setNotice(t('Çözünürlük geri yükseldi: {h}p', { h: height }))
    }
  }, [live, size])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(undefined), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])
  return notice
}

export function StreamShell({ platform, profileKey, title, stage, live, stats, queue, controller, image, onExit, children }: Props) {
  useSessionReport(platform, title, live, stats)
  const notice = useResolutionNotice(live, stats?.size)
  const touch = useTouchControls()
  const settings = settingsFor(getSettings(), profileKey)
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
      const pad = connectedPads()[0]
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

      {touch && live && !menu && <TouchControls platform={platform} onMenu={() => setMenu(true)} />}

      {!live && (
        <div className="stream-veil" style={image && settings.showGameImage ? { backgroundImage: `linear-gradient(rgba(6, 7, 10, 0.72), rgba(6, 7, 10, 0.9)), url("${image}")` } : undefined}>
          {image && <img className="launch-art" src={image} alt="" />}
          <h2>{title}</h2>
          <div className="launch-bar" aria-hidden="true"><span /></div>
          {queue ? <QueueCard queue={queue} /> : <p>{stage}</p>}
          <button className="ghost" onClick={onExit}>{t('Vazgeç')}</button>
        </div>
      )}

      {showStats && stats && (
        <div className={`stream-stats ${settings.statsVertical ? 'stream-stats--vertical' : ''}`}>
          <b>{stats.fps}</b> {t('kare/sn')} · <b>{stats.mbps.toFixed(1)}</b> Mb/{t('sn')} · {t('kayıp')} <b>{stats.lost}</b>
          {stats.rttMs !== undefined && <> · {t('gecikme')} <b>{stats.rttMs}</b> ms</>}
          {stats.decodeMs !== undefined && <> · {t('çözme')} <b>{stats.decodeMs.toFixed(1)}</b> ms</>}
          {stats.jitterMs !== undefined && <> · {t('dalgalanma')} <b>{stats.jitterMs.toFixed(1)}</b> ms</>}
          {stats.skipped ? <> · {t('atlanan')} <b>{stats.skipped}</b></> : null}
          {stats.size && <> · {stats.size}</>}
          {controller && <> · {controller}</>}
        </div>
      )}

      {notice && !menu && <div className="stream-notice" role="status">{notice}</div>}

      {menu && (
        <div className="stream-menu" role="dialog" aria-label={t('Akış menüsü')} ref={menuRef}>
          <h3>{title}</h3>
          <button className="primary" onClick={() => setMenu(false)}>{t('Oyuna dön')}</button>
          <button className="ghost" onClick={() => setShowStats((s) => !s)}>{showStats ? t('İstatistikleri gizle') : t('İstatistikleri göster')}</button>
          <button className="ghost danger" onClick={onExit}>{t('Akışı bitir')}</button>
          <small>{t('Kolda View + Menu düğmelerini basılı tutarak açılır.')}</small>
        </div>
      )}
    </div>
  )
}
