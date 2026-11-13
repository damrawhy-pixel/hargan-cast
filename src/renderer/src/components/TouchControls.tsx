// On-screen controller for phones and tablets: two floating sticks, a D-pad, the
// face buttons, shoulders and the middle row, labelled for the console being
// streamed. It drives the virtual pad (lib/virtualPad), which both services read.
// Presses update the DOM directly; nothing here re-renders while a finger moves.
import { t } from '../../../shared/i18n'
import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { getSettings } from '../lib/useSettings'
import { PAD, setButton, setStick, setVirtualPad } from '../lib/virtualPad'

export type TouchPlatform = 'playstation' | 'xbox'

type Point = { x: number; y: number }
type Points = Map<number, Point>

const DOUBLE_TAP_MS = 280
const TAP_MS = 220
/** Share of the stick's reach a tap may move and still count as one. */
const TAP_TRAVEL = 0.25

// A short tick under the finger, where the device can do it (Android; iOS has no web vibration).
function tick() {
  if (getSettings().touchVibrate) navigator.vibrate?.(8)
}

// Keeps a finger's events coming to the control it landed on, even when it slides off.
function capture(e: ReactPointerEvent<HTMLElement>) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    // The pointer is already gone; its up event follows.
  }
}

/** Tracks every finger on one element, in the element's own pixels. */
function pointerHandlers(points: Points, onChange: (el: HTMLElement) => void) {
  const at = (e: ReactPointerEvent<HTMLElement>): Point => {
    const box = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }
  const end = (e: ReactPointerEvent<HTMLElement>) => {
    if (points.delete(e.pointerId)) onChange(e.currentTarget)
  }
  return {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      e.preventDefault()
      capture(e)
      points.set(e.pointerId, at(e))
      onChange(e.currentTarget)
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      if (!points.has(e.pointerId)) return
      points.set(e.pointerId, at(e))
      onChange(e.currentTarget)
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
  }
}

/** Presses exactly the buttons in `next`, marking them on screen and ticking once for new ones. */
function useHeldButtons() {
  const held = useRef(new Set<number>())
  useEffect(() => () => held.current.forEach((b) => setButton(b, false)), [])
  return (el: HTMLElement, next: Set<number>) => {
    let pressed = false
    for (const b of next) {
      if (held.current.has(b)) continue
      setButton(b, true)
      el.querySelector(`[data-b="${b}"]`)?.classList.add('is-on')
      pressed = true
    }
    for (const b of held.current) {
      if (next.has(b)) continue
      setButton(b, false)
      el.querySelector(`[data-b="${b}"]`)?.classList.remove('is-on')
    }
    held.current = next
    if (pressed) tick()
  }
}

function Key({ button, className, label, children }: { button: number; className: string; label: string; children: ReactNode }) {
  const points = useRef<Points>(new Map()).current
  const apply = useHeldButtons()
  return (
    <div className={`tc-zone ${className}`} aria-label={label} role="button" {...pointerHandlers(points, (el) => apply(el, new Set(points.size ? [button] : [])))}>
      <span className="tc-key" data-b={button}>{children}</span>
    </div>
  )
}

const FACE: { button: number; slot: 'n' | 'e' | 's' | 'w'; x: number; y: number }[] = [
  { button: PAD.NORTH, slot: 'n', x: 0.5, y: 0.17 },
  { button: PAD.EAST, slot: 'e', x: 0.83, y: 0.5 },
  { button: PAD.SOUTH, slot: 's', x: 0.5, y: 0.83 },
  { button: PAD.WEST, slot: 'w', x: 0.17, y: 0.5 },
]

function PsSymbol({ slot }: { slot: 'n' | 'e' | 's' | 'w' }) {
  const shape = {
    n: <path d="M12 4.5 20 18.5H4z" />,
    e: <circle cx="12" cy="12" r="7" />,
    s: <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />,
    w: <rect x="5.5" y="5.5" width="13" height="13" />,
  }[slot]
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round">
      {shape}
    </svg>
  )
}

// One area for all four, so a thumb resting between two presses both, as on a controller.
function FaceButtons({ platform }: { platform: TouchPlatform }) {
  const points = useRef<Points>(new Map()).current
  const apply = useHeldButtons()
  const letters = { n: 'Y', e: 'B', s: 'A', w: 'X' }
  const onChange = (el: HTMLElement) => {
    const size = el.clientWidth
    const reach = size * 0.24
    const next = new Set<number>()
    for (const p of points.values()) for (const f of FACE) if (Math.hypot(p.x - f.x * size, p.y - f.y * size) <= reach) next.add(f.button)
    apply(el, next)
  }
  return (
    <div className="tc-zone tc-face" aria-label={t('Yüz düğmeleri')} {...pointerHandlers(points, onChange)}>
      {FACE.map((f) => (
        <span key={f.slot} className={`tc-key tc-face-${f.slot}`} data-b={f.button}>
          {platform === 'playstation' ? <PsSymbol slot={f.slot} /> : letters[f.slot]}
        </span>
      ))}
    </div>
  )
}

// Eight directions; the diagonals press two arrows.
const SECTORS = [[PAD.RIGHT], [PAD.RIGHT, PAD.DOWN], [PAD.DOWN], [PAD.DOWN, PAD.LEFT], [PAD.LEFT], [PAD.LEFT, PAD.UP], [PAD.UP], [PAD.UP, PAD.RIGHT]]

function DPad() {
  const points = useRef<Points>(new Map()).current
  const apply = useHeldButtons()
  const onChange = (el: HTMLElement) => {
    const half = el.clientWidth / 2
    const next = new Set<number>()
    for (const p of points.values()) {
      const dx = p.x - half
      const dy = p.y - half
      if (Math.hypot(dx, dy) < half * 0.22) continue
      const sector = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8
      SECTORS[sector].forEach((b) => next.add(b))
    }
    apply(el, next)
  }
  return (
    <div className="tc-zone tc-dpad" aria-label={t('Yön tuşları')} {...pointerHandlers(points, onChange)}>
      <span className="tc-key tc-arrow tc-arrow-up" data-b={PAD.UP} />
      <span className="tc-key tc-arrow tc-arrow-right" data-b={PAD.RIGHT} />
      <span className="tc-key tc-arrow tc-arrow-down" data-b={PAD.DOWN} />
      <span className="tc-key tc-arrow tc-arrow-left" data-b={PAD.LEFT} />
    </div>
  )
}

// The stick appears under the thumb wherever it lands in its area. A quick second
// tap holds the stick's click (L3/R3) for as long as the thumb stays down.
function Stick({ side }: { side: 'left' | 'right' }) {
  const base = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  const finger = useRef<number>()
  const origin = useRef<Point>({ x: 0, y: 0 })
  // When the last touch was a quick tap that barely moved; a thumb that only let go
  // and grabbed the stick again must not click it.
  const lastTap = useRef(0)
  const downAt = useRef(0)
  const travel = useRef(0)
  const click = side === 'left' ? PAD.L3 : PAD.R3

  useEffect(
    () => () => {
      setStick(side, 0, 0)
      setButton(click, false)
    },
    [side, click],
  )

  const local = (e: ReactPointerEvent<HTMLElement>): Point => {
    const box = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }

  const release = () => {
    finger.current = undefined
    const now = performance.now()
    lastTap.current = now - downAt.current < TAP_MS && travel.current < TAP_TRAVEL ? now : 0
    setStick(side, 0, 0)
    setButton(click, false)
    base.current?.classList.remove('is-on', 'is-clicked')
    base.current?.style.removeProperty('left')
    base.current?.style.removeProperty('top')
    knob.current?.style.removeProperty('transform')
  }

  return (
    <div
      className={`tc-zone tc-stick tc-stick-${side}`}
      aria-label={side === 'left' ? t('Sol çubuk') : t('Sağ çubuk')}
      onPointerDown={(e) => {
        if (finger.current !== undefined) return
        e.preventDefault()
        capture(e)
        finger.current = e.pointerId
        origin.current = local(e)
        const b = base.current!
        b.style.left = `${origin.current.x}px`
        b.style.top = `${origin.current.y}px`
        b.classList.add('is-on')
        downAt.current = performance.now()
        travel.current = 0
        if (lastTap.current && downAt.current - lastTap.current < DOUBLE_TAP_MS) {
          lastTap.current = 0
          setButton(click, true)
          b.classList.add('is-clicked')
        }
        tick()
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== finger.current) return
        const radius = (base.current?.clientWidth ?? 100) / 2
        const p = local(e)
        let dx = p.x - origin.current.x
        let dy = p.y - origin.current.y
        const length = Math.hypot(dx, dy)
        travel.current = Math.max(travel.current, length / radius)
        if (length > radius) {
          dx *= radius / length
          dy *= radius / length
        }
        knob.current!.style.transform = `translate(${dx}px, ${dy}px)`
        setStick(side, dx / radius, dy / radius)
      }}
      onPointerUp={(e) => e.pointerId === finger.current && release()}
      onPointerCancel={(e) => e.pointerId === finger.current && release()}
      onLostPointerCapture={(e) => e.pointerId === finger.current && release()}
    >
      <div className="tc-stick-base" ref={base}>
        <div className="tc-stick-knob" ref={knob} />
      </div>
    </div>
  )
}

const ICON = {
  view: (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="7" width="11" height="9" rx="1.5" />
      <path d="M9 4h9.5A1.5 1.5 0 0 1 20 5.5V13" />
    </svg>
  ),
  menu: (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M5 7h14M5 12h14M5 17h14" />
    </svg>
  ),
  home: (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />
    </svg>
  ),
  pause: (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <rect x="6.5" y="5" width="4" height="14" rx="1" />
      <rect x="13.5" y="5" width="4" height="14" rx="1" />
    </svg>
  ),
}

export function TouchControls({ platform, onMenu }: { platform: TouchPlatform; onMenu(): void }) {
  useEffect(() => {
    setVirtualPad(true)
    return () => setVirtualPad(false)
  }, [])

  const { touchOpacity, touchSize } = getSettings()
  const ps = platform === 'playstation'
  const style = { '--tc-opacity': touchOpacity / 100, '--tc-scale': touchSize / 100 } as CSSProperties

  return (
    <div className={`touch touch--${platform}`} style={style}>
      <Key button={PAD.L2} className="tc-l2" label={ps ? 'L2' : 'LT'}>{ps ? 'L2' : 'LT'}</Key>
      <Key button={PAD.L1} className="tc-l1" label={ps ? 'L1' : 'LB'}>{ps ? 'L1' : 'LB'}</Key>
      <Key button={PAD.R2} className="tc-r2" label={ps ? 'R2' : 'RT'}>{ps ? 'R2' : 'RT'}</Key>
      <Key button={PAD.R1} className="tc-r1" label={ps ? 'R1' : 'RB'}>{ps ? 'R1' : 'RB'}</Key>

      <div className="tc-top">
        <button className="tc-pause" aria-label={t('Akış menüsü')} onClick={onMenu}>{ICON.pause}</button>
        {ps && (
          <Key button={PAD.TOUCHPAD} className="tc-touchpad" label={t('Dokunmatik yüzey')}>
            {t('Dokunmatik yüzey')}
          </Key>
        )}
      </div>

      <DPad />
      <FaceButtons platform={platform} />
      <Stick side="left" />
      <Stick side="right" />

      <div className="tc-middle">
        <Key button={PAD.L3} className="tc-small" label={ps ? 'L3' : t('Sol çubuk tıklaması')}>{ps ? 'L3' : 'LS'}</Key>
        <Key button={PAD.VIEW} className="tc-small" label={ps ? t('Oluştur') : t('Görünüm')}>{ICON.view}</Key>
        <Key button={PAD.HOME} className="tc-small tc-home" label={ps ? t('PS düğmesi') : t('Xbox düğmesi')}>{ICON.home}</Key>
        <Key button={PAD.MENU} className="tc-small" label={ps ? t('Seçenekler') : t('Menü')}>{ICON.menu}</Key>
        <Key button={PAD.R3} className="tc-small" label={ps ? 'R3' : t('Sağ çubuk tıklaması')}>{ps ? 'R3' : 'RS'}</Key>
      </div>
    </div>
  )
}
