import { locale, t } from '../../../shared/i18n'
import { useEffect, useState } from 'react'
import { useStore } from '../lib/store'

export type Space = 'home' | 'playstation' | 'xbox' | 'settings'

// Bumper order. Settings sits last, behind the gear on the right, as on a console.
export const SPACES: [Space, string][] = [['home', 'Ana Sayfa'], ['playstation', 'PlayStation'], ['xbox', 'Xbox'], ['settings', 'Ayarlar']]
const spaceLabel = (id: Space, label: string) => (id === 'home' ? t('Ana Sayfa') : id === 'settings' ? t('Ayarlar') : label)
const TABS = SPACES.filter(([id]) => id !== 'settings')

const CLOCK_MS = 15_000

function Clock() {
  const format = () => new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
  const [time, setTime] = useState(format)
  useEffect(() => {
    const timer = setInterval(() => setTime(format()), CLOCK_MS)
    return () => clearInterval(timer)
  }, [])
  return <time className="clock">{time}</time>
}

const Gear = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Zm8.2 4.7-1.9-.4a6.6 6.6 0 0 1-.6 1.5l1.1 1.6-1.6 1.6-1.6-1.1c-.5.3-1 .5-1.5.6l-.4 1.9h-2.3l-.4-1.9a6.6 6.6 0 0 1-1.5-.6l-1.6 1.1-1.6-1.6 1.1-1.6c-.3-.5-.5-1-.6-1.5l-1.9-.4v-2.3l1.9-.4c.1-.5.3-1 .6-1.5L5.3 6.9l1.6-1.6 1.6 1.1c.5-.3 1-.5 1.5-.6l.4-1.9h2.3l.4 1.9c.5.1 1 .3 1.5.6l1.6-1.1 1.6 1.6-1.1 1.6c.3.5.5 1 .6 1.5l1.9.4v2.3Z" />
  </svg>
)

interface Props {
  space: Space
  onSelect(space: Space): void
  onAbout(): void
}

export function TopBar({ space, onSelect, onAbout }: Props) {
  const xbox = useStore((s) => s.xbox)

  return (
    <header className="topbar">
      <button className="brand" title={t('Hakkında ve yasal bildirimler')} onClick={onAbout}>
        <img src="./logo-64.png" alt="Hargan Cast" />
      </button>
      <nav className="tabs" role="tablist" aria-label={t('Alanlar')}>
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={space === id} data-tab={id} onClick={() => onSelect(id)}>{spaceLabel(id, label)}</button>
        ))}
      </nav>
      <div className="topbar-tools">
        <button className="round-button" data-tab="settings" aria-label={t('Ayarlar')} aria-selected={space === 'settings'} onClick={() => onSelect('settings')}>
          <Gear />
        </button>
        {xbox.gamerpic ? <img className="avatar" src={xbox.gamerpic} alt="" title={xbox.gamertag} /> : <span className="avatar avatar--empty" aria-hidden="true" />}
        <Clock />
      </div>
    </header>
  )
}
