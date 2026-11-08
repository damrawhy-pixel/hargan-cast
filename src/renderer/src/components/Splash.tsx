import { useEffect, useState } from 'react'
import { reducedMotion } from '../lib/motion'
import { sounds } from '../lib/sounds'

// in: the logo arrives; out: it lifts away while the screen opens from the middle.
type Phase = 'in' | 'out'

const HOLD_MS = 2000
const OUT_MS = 850
const QUICK_MS = 500

interface Props {
  onReveal(): void
  onDone(): void
}

export function Splash({ onReveal, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('in')

  useEffect(() => {
    const quick = reducedMotion()
    if (!quick) sounds.startup()
    const timer = setTimeout(() => setPhase('out'), quick ? QUICK_MS : HOLD_MS)
    // Any key, click or pad button skips ahead.
    const skip = () => setPhase('out')
    window.addEventListener('keydown', skip)
    window.addEventListener('pointerdown', skip)
    let frame = requestAnimationFrame(function poll() {
      if (navigator.getGamepads().some((p) => p?.buttons.some((b) => b.pressed))) skip()
      else frame = requestAnimationFrame(poll)
    })
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
    }
  }, [])

  useEffect(() => {
    if (phase !== 'out') return
    onReveal()
    const timer = setTimeout(onDone, reducedMotion() ? 0 : OUT_MS)
    return () => clearTimeout(timer)
  }, [phase, onReveal, onDone])

  return (
    <div className={`splash splash--${phase}`} aria-hidden="true">
      <div className="splash-fire" />
      <div className="splash-ice" />
      <div className="splash-stage">
        <div className="splash-mark">
          <div className="splash-ring" />
          <div className="splash-logo">
            <img src="./logo-512.png" alt="" draggable={false} />
            <span className="splash-shine" />
          </div>
        </div>
        <p className="splash-line" lang="en">PlayStation - Xbox Cloud Gaming</p>
      </div>
      <div className="splash-wave" />
      <footer className="splash-footer" lang="en">HarganCast © All Rights Reserved</footer>
    </div>
  )
}
