import { useEffect, useRef, useState } from 'react'
import { t } from '../../../shared/i18n'
import { updateSettings, useSettings } from '../lib/useSettings'
import { readTouchLayout, TouchControls, type TouchGroup, type TouchLayout, type TouchPlatform } from './TouchControls'

/**
 * Moves and resizes the on-screen controls, for each console's layout: drag a
 * group, pick its size, save. The sticks keep following the thumb anywhere in
 * their half, so they are not moved.
 */
export function TouchEditor({ onClose }: { onClose(): void }) {
  const settings = useSettings()
  const [platform, setPlatform] = useState<TouchPlatform>('playstation')
  const [layouts, setLayouts] = useState(() => ({ playstation: readTouchLayout(settings.touchLayout, 'playstation'), xbox: readTouchLayout(settings.touchLayout, 'xbox') }))
  const [selected, setSelected] = useState<TouchGroup>()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.querySelector<HTMLElement>('button')?.focus(), [])

  const layout = layouts[platform]
  const change = (group: TouchGroup, patch: Partial<{ x: number; y: number; s: number }>) =>
    setLayouts((all) => {
      const current = all[platform][group] ?? { x: 0, y: 0, s: 1 }
      const next: TouchLayout = { ...all[platform], [group]: { ...current, ...patch } }
      return { ...all, [platform]: next }
    })
  const round = (n: number) => Math.round(Math.max(-100, Math.min(100, n)) * 10) / 10

  return (
    <div className="touch-editor" ref={ref} role="dialog" aria-label={t('Dokunmatik düzen')}>
      <TouchControls
        platform={platform}
        onMenu={() => {}}
        arrange={{ editing: true, layout, selected, onSelect: setSelected, onMove: (g, x, y) => change(g, { x: round(x), y: round(y) }) }}
      />
      <div className="touch-editor-bar glass">
        <div className="touch-editor-tabs">
          {(['playstation', 'xbox'] as const).map((p) => (
            <button key={p} className={p === platform ? 'primary' : 'ghost'} onClick={() => setPlatform(p)}>{p === 'playstation' ? 'PlayStation' : 'Xbox'}</button>
          ))}
        </div>
        <label>
          {t('Boyut')}
          <input
            type="range"
            min={50}
            max={200}
            step={5}
            disabled={!selected}
            value={Math.round((selected && layout[selected]?.s ? layout[selected]!.s : 1) * 100)}
            onChange={(e) => selected && change(selected, { s: Number(e.target.value) / 100 })}
          />
        </label>
        <small>{selected ? t('Sürükleyerek taşı, kaydırıcıyla boyutlandır.') : t('Taşımak için bir düğme grubuna dokun.')}</small>
        <button className="ghost" onClick={() => setLayouts((all) => ({ ...all, [platform]: {} }))}>{t('Sıfırla')}</button>
        <button className="ghost" onClick={onClose}>{t('Vazgeç')}</button>
        <button
          className="primary"
          onClick={() => {
            void updateSettings({ touchLayout: JSON.stringify(layouts) })
            onClose()
          }}
        >
          {t('Kaydet')}
        </button>
      </div>
    </div>
  )
}
