import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { MOBILE } from '../lib/platform'
import { connectedPads } from '../lib/gamepads'
import { getSettings } from '../lib/useSettings'
import { settingsFor } from '../../../shared/settings'
import { physicalPads } from '../lib/virtualPad'
import { installLayout, parseButtonMap } from '../lib/remap'
import { ReplayBuffer } from '../lib/capture'
import { Achievements } from './Achievements'
import { svgMatrix } from '../lib/colorAssist'
import { saveRecord } from '../lib/history'
import { startGyroAim } from '../lib/gyro'
import { installTriggerBridge } from '../lib/dsTriggers'
import { TouchControls, type TouchPlatform } from './TouchControls'
import { t, type Message } from '../../../shared/i18n'

export interface StreamStats {
  fps: number
  mbps: number
  lost: number
  size?: string
  rttMs?: number
  decodeMs?: number
  /** Time in the network jitter buffer before decoding, ms. */
  bufferMs?: number
  /** Time a decoded frame waits for its screen refresh, ms. */
  waitMs?: number
  /** The app's picture filters on the graphics card, per frame, ms. */
  gpuMs?: number
  /** A filter just turned off because the graphics card could not keep up. */
  lightened?: Message
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
  /** The microphone in Remote Play, mutable from the menu. */
  microphone?: { muted: boolean; toggle(): void }
  /** An Xbox game's ids, for its achievements in the menu. */
  achievements?: { productId: string; titleId: string }
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

/**
 * The part of the delay that can be measured here: the trip to the server and
 * back, then buffering, decoding and waiting for the screen. The server's own
 * time to run the game and encode the frame comes on top.
 */
export function totalLatency(s: StreamStats): number | undefined {
  if (s.rttMs === undefined) return undefined
  return Math.round(s.rttMs + (s.bufferMs ?? 0) + (s.decodeMs ?? 0) + (s.waitMs ?? 0))
}

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
  // A TV has no touch screen to put them on.
  const touchScreen = typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches
  return MOBILE && (mode === 'on' || (mode === 'auto' && touchScreen && !padInUse))
}

// One line per stream in the log (time to picture, frame rate, bit rate, loss,
// latency), so "it stuttered yesterday" can be looked up afterwards.
function useSessionReport(platform: string, key: string, title: string, live: boolean, stats?: StreamStats) {
  const started = useRef(Date.now())
  const series = useRef({ fps: [] as number[], mbps: [] as number[], delay: [] as (number | null)[] })
  const totals = useRef({ samples: 0, fps: 0, minFps: Infinity, mbps: 0, rtt: 0, rttSamples: 0, total: 0, totalSamples: 0, decode: 0, decodeSamples: 0, jitter: 0, jitterSamples: 0, skipped: 0, lost: 0, size: '', liveAt: 0 })

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
    const total = totalLatency(stats)
    series.current.fps.push(stats.fps)
    series.current.mbps.push(Math.round(stats.mbps * 10) / 10)
    series.current.delay.push(total ?? null)
    if (total !== undefined) {
      t.total += total
      t.totalSamples++
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
          `${avg(t.mbps, t.samples)} Mb/s, lost ${t.lost}, rtt ${avg(t.rtt, t.rttSamples)} ms, measured delay ${avg(t.total, t.totalSamples)} ms, decode ${avg(t.decode, t.decodeSamples)} ms, jitter ${avg(t.jitter, t.jitterSamples)} ms, skipped ${t.skipped}, ${t.size || '-'}`,
      )
      if (t.liveAt && t.samples >= 10)
        saveRecord({
          at: new Date(started.current).toISOString(),
          platform,
          key,
          title,
          seconds,
          toPicture: (t.liveAt - started.current) / 1000,
          avgFps: t.fps / t.samples,
          minFps: t.minFps,
          avgMbps: t.mbps / t.samples,
          avgDelay: t.totalSamples ? t.total / t.totalSamples : undefined,
          lost: t.lost,
          skipped: t.skipped,
          size: t.size,
          ...series.current,
        })
    },
    [platform, key, title],
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

export function StreamShell({ platform, profileKey, title, stage, live, stats, queue, controller, image, achievements, microphone, onExit, children }: Props) {
  useSessionReport(platform, profileKey, title, live, stats)
  const notice = useResolutionNotice(live, stats?.size)
  const touch = useTouchControls()
  const settings = settingsFor(getSettings(), profileKey)
  const ratio = settings.videoFormat.includes(':') ? settings.videoFormat.replace(':', ' / ') : undefined
  // Any CSS filter, even a neutral one, keeps video off the GPU's direct path to the screen.
  const adjusted = settings.brightness !== 100 || settings.contrast !== 100 || settings.saturation !== 100
  const assist = settings.colorAssist !== 'off' ? settings.colorAssist : undefined
  const filters = [adjusted && `brightness(${settings.brightness}%) contrast(${settings.contrast}%) saturate(${settings.saturation}%)`, assist && 'url(#hc-color-assist)'].filter(Boolean)
  const pictureStyle = {
    '--stream-fit': FIT[settings.videoFormat] ?? 'contain',
    '--stream-ratio': ratio ?? 'auto',
    filter: filters.length ? filters.join(' ') : undefined,
  } as CSSProperties

  // The user's controller layout, for this stream's whole life.
  const [layout] = useState(() => ({ map: parseButtonMap(settings.buttonMap), swapSticks: settings.swapSticks, invertY: settings.invertY }))
  useEffect(() => installLayout(layout), [layout])

  const [menu, setMenu] = useState(false)
  // The picture's filters lightened for a slow graphics card: said once, briefly.
  const [lightNotice, setLightNotice] = useState<string>()
  const lightened = stats?.lightened
  useEffect(() => {
    if (!lightened) return
    setLightNotice(t('Ekran kartı yetişemediği için {what} kapatıldı.', { what: t(lightened) }))
    const timer = setTimeout(() => setLightNotice(undefined), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [lightened])
  // Gyro aiming with a DualSense in Xbox games, on the desktop.
  const [gyro] = useState(() => ({ mode: settings.xboxGyro, sensitivity: settings.xboxGyroSensitivity, invertX: settings.xboxGyroInvertX, invertY: settings.xboxGyroInvertY }))
  useEffect(() => {
    if (platform !== 'xbox' || MOBILE || gyro.mode === 'off') return
    let cancelled = false
    let stop: (() => void) | undefined
    void startGyroAim({ ...gyro, mode: gyro.mode }).then((s) => {
      if (cancelled) s?.()
      else stop = s
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [gyro, platform])

  // Xbox trigger rumble on a DualSense's triggers, through the PlayStation core.
  const [triggers] = useState(() => platform === 'xbox' && !MOBILE && settings.xboxDualSenseTriggers && Boolean(window.hc.platform.dualSenseTriggers))
  useEffect(() => (triggers ? installTriggerBridge((l, r) => window.hc.platform.dualSenseTriggers!(l, r)) : undefined), [triggers])

  // Discord's "Playing" line, while the picture is up.
  useEffect(() => {
    if (!live) return
    window.hc.platform.presence?.(title, platform === 'playstation' ? 'PlayStation' : 'Xbox')
    return () => window.hc.platform.presence?.('', '')
  }, [live, title, platform])
  // Screenshots and the replay buffer, on the desktop.
  const [capture] = useState(() => ({ shots: !MOBILE && Boolean(window.hc.platform.screenshot), replay: !MOBILE && settings.replayBuffer, seconds: settings.replaySeconds }))
  const replay = useRef<ReplayBuffer>()
  const [replaying, setReplaying] = useState(false)
  const [clean, setClean] = useState(false)
  const [toast, setToast] = useState<{ text: string; file?: string }>()
  useEffect(() => {
    if (!capture.replay || !live) return
    let stopped = false
    void ReplayBuffer.start(capture.seconds).then((buffer) => {
      if (stopped) return buffer?.stop()
      replay.current = buffer
      setReplaying(Boolean(buffer))
    })
    return () => {
      stopped = true
      replay.current?.stop()
      replay.current = undefined
      setReplaying(false)
    }
  }, [capture, live])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(undefined), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const screenshot = async () => {
    setMenu(false)
    // Without the stats and menus: two frames for them to leave the screen.
    setClean(true)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const file = await window.hc.platform.screenshot?.(title).catch(() => undefined)
    setClean(false)
    setToast(file ? { text: t('Ekran görüntüsü kaydedildi'), file } : { text: t('Ekran görüntüsü alınamadı') })
  }
  const saveClip = async () => {
    setMenu(false)
    const data = await replay.current?.save().catch(() => undefined)
    if (!data) return setToast({ text: t('Kaydedilecek görüntü henüz yok') })
    const file = await window.hc.platform.saveClip?.(title, data).catch(() => undefined)
    setToast(file ? { text: t('Son {n} saniye kaydedildi', { n: capture.seconds }), file } : { text: t('Kayıt kaydedilemedi') })
  }
  // The key handler is set up once; it reaches the current versions through this.
  const actions = useRef({ screenshot, saveClip })
  useEffect(() => {
    actions.current = { screenshot, saveClip }
  })

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
      if (e.code === 'F12' && !e.repeat) {
        e.preventDefault()
        void actions.current.screenshot()
      }
      if (e.code === 'F10' && !e.repeat) {
        e.preventDefault()
        void actions.current.saveClip()
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
      className={`stream ${idle && !menu && settings.hideCursor ? 'stream--idle' : ''} ${clean ? 'stream--clean' : ''}`}
      onMouseMove={onMove}
      onDoubleClick={() => settings.doubleClickFullscreen && window.hc.platform.toggleFullscreen()}
    >
      {assist && (
        <svg className="stream-filters" aria-hidden="true">
          <filter id="hc-color-assist" colorInterpolationFilters="linearRGB">
            <feColorMatrix type="matrix" values={svgMatrix(assist)} />
          </filter>
        </svg>
      )}
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
          {stats.bufferMs !== undefined && <> · {t('tampon')} <b>{stats.bufferMs.toFixed(0)}</b> ms</>}
          {stats.decodeMs !== undefined && <> · {t('çözme')} <b>{stats.decodeMs.toFixed(1)}</b> ms</>}
          {stats.waitMs !== undefined && <> · {t('ekran sırası')} <b>{stats.waitMs.toFixed(1)}</b> ms</>}
          {stats.gpuMs !== undefined && <> · {t('süzgeçler')} <b>{stats.gpuMs.toFixed(1)}</b> ms</>}
          {totalLatency(stats) !== undefined && <> · {t('toplam')} ≈ <b>{totalLatency(stats)}</b> ms</>}
          {stats.jitterMs !== undefined && <> · {t('dalgalanma')} <b>{stats.jitterMs.toFixed(1)}</b> ms</>}
          {stats.skipped ? <> · {t('atlanan')} <b>{stats.skipped}</b></> : null}
          {stats.size && <> · {stats.size}</>}
          {controller && <> · {controller}</>}
        </div>
      )}

      {(lightNotice ?? notice) && !menu && !toast && <div className="stream-notice" role="status">{lightNotice ?? notice}</div>}
      {toast && !clean && (
        <div className="stream-notice stream-toast" role="status">
          {toast.text}
          {toast.file && <button className="link" onClick={() => window.hc.platform.showCapture?.(toast.file!)}>{t('Klasörde göster')}</button>}
        </div>
      )}

      {menu && (
        <div className="stream-menu" role="dialog" aria-label={t('Akış menüsü')} ref={menuRef}>
          <h3>{title}</h3>
          <button className="primary" onClick={() => setMenu(false)}>{t('Oyuna dön')}</button>
          <button className="ghost" onClick={() => setShowStats((s) => !s)}>{showStats ? t('İstatistikleri gizle') : t('İstatistikleri göster')}</button>
          {microphone && <button className="ghost" onClick={microphone.toggle}>{microphone.muted ? t('Mikrofonu aç') : t('Mikrofonu sustur')}</button>}
          {capture.shots && <button className="ghost" onClick={() => void screenshot()}>{t('Ekran görüntüsü al (F12)')}</button>}
          {achievements && <Achievements productId={achievements.productId} titleId={achievements.titleId} compact />}
          {replaying && <button className="ghost" onClick={() => void saveClip()}>{t('Son {n} saniyeyi kaydet (F10)', { n: capture.seconds })}</button>}
          <button className="ghost danger" onClick={onExit}>{t('Akışı bitir')}</button>
          <small>{t('Kolda View + Menu düğmelerini basılı tutarak açılır.')}</small>
        </div>
      )}
    </div>
  )
}
