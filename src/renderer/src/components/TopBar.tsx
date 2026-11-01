import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type Space = 'home' | 'playstation' | 'xbox' | 'settings'

export const SPACES: [Space, string][] = [['home', 'Ana Sayfa'], ['playstation', 'PlayStation'], ['xbox', 'Xbox'], ['settings', 'Ayarlar']]

const CLOCK_MS = 15_000

function Clock() {
  const format = () => new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  const [time, setTime] = useState(format)
  useEffect(() => {
    const timer = setInterval(() => setTime(format()), CLOCK_MS)
    return () => clearInterval(timer)
  }, [])
  return <time className="clock">{time}</time>
}

interface Props {
  space: Space
  onSelect(space: Space): void
  onAbout(): void
}

export function TopBar({ space, onSelect, onAbout }: Props) {
  const nav = useRef<HTMLElement>(null)
  const [indicator, setIndicator] = useState({ x: 0, width: 0 })

  useLayoutEffect(() => {
    const measure = () => {
      const tab = nav.current?.querySelector<HTMLElement>(`[data-tab="${space}"]`)
      if (tab) setIndicator({ x: tab.offsetLeft, width: tab.offsetWidth })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [space])

  return (
    <header className="topbar">
      <button className="brand" title="Hakkında ve yasal bildirimler" onClick={onAbout}>
        <img src="./logo-64.png" alt="" />
        <span>Hargan<em>Cast</em></span>
      </button>
      <nav className="tabs" role="tablist" aria-label="Alanlar" ref={nav}>
        <span className="tabs-indicator" style={{ transform: `translateX(${indicator.x}px)`, width: indicator.width }} />
        {SPACES.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={space === id} data-tab={id} onClick={() => onSelect(id)}>{label}</button>
        ))}
      </nav>
      <Clock />
    </header>
  )
}
