import { useEffect, useRef, useState } from 'react'
import { t } from '../../../shared/i18n'
import { BUTTON_COUNT, buttonName, formatButtonMap, parseButtonMap } from '../lib/remap'
import { physicalPads } from '../lib/virtualPad'

export interface LayoutValue {
  buttonMap: string
  swapSticks: boolean
  invertY: boolean
}

const CAPTURE_MS = 5000

function Switch({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange(on: boolean): void }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="setting-control">
        <button role="switch" aria-checked={on} aria-label={label} className="switch" data-nav onClick={() => onChange(!on)}>
          <span />
        </button>
      </div>
    </div>
  )
}
const BUTTONS = Array.from({ length: BUTTON_COUNT }, (_, i) => i)

/**
 * Which physical button presses each button the game sees. A row can be set from
 * its list or by pressing the button on the controller.
 */
export function LayoutEditor({ value, onChange }: { value: LayoutValue; onChange(patch: Partial<LayoutValue>): void }) {
  const map = parseButtonMap(value.buttonMap)
  const [capturing, setCapturing] = useState<number>()
  const assign = useRef<(out: number, source: number) => void>(() => {})
  useEffect(() => {
    assign.current = (out, source) => {
      const next = parseButtonMap(value.buttonMap)
      next[out] = source
      onChange({ buttonMap: formatButtonMap(next) })
    }
  })

  useEffect(() => {
    if (capturing === undefined) return
    const started = performance.now()
    // A button already down when listening starts (the one that started it) is not the answer.
    const held = new Set<string>()
    for (const pad of physicalPads()) pad.buttons.forEach((b, i) => b.pressed && held.add(`${pad.index}:${i}`))
    let frame = 0
    const poll = () => {
      for (const pad of physicalPads()) {
        for (let i = 0; i < Math.min(pad.buttons.length, BUTTON_COUNT); i++) {
          const key = `${pad.index}:${i}`
          if (!pad.buttons[i].pressed) held.delete(key)
          else if (!held.has(key)) {
            assign.current(capturing, i)
            setCapturing(undefined)
            return
          }
        }
      }
      if (performance.now() - started > CAPTURE_MS) return setCapturing(undefined)
      frame = requestAnimationFrame(poll)
    }
    frame = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(frame)
  }, [capturing])

  return (
    <div className="layout-editor">
      <Switch label={t('Sol ve sağ çubuğu değiştir')} on={value.swapSticks} onChange={(on) => onChange({ swapSticks: on })} />
      <Switch label={t('Sağ çubuğun dikeyini ters çevir')} hint={t('Kamerayı uçak kumandası gibi yönetmek için.')} on={value.invertY} onChange={(on) => onChange({ invertY: on })} />
      <div className="layout-grid" role="group" aria-label={t('Düğme atamaları')}>
        {BUTTONS.map((out) => (
          <div className="layout-row" key={out}>
            <span className={map[out] !== out ? 'layout-changed' : undefined}>{buttonName(out)}</span>
            <select data-nav aria-label={buttonName(out)} value={map[out]} onChange={(e) => assign.current(out, Number(e.target.value))}>
              {BUTTONS.map((source) => <option key={source} value={source}>{buttonName(source)}</option>)}
            </select>
            <button className="ghost" data-nav aria-label={`${buttonName(out)}: ${capturing === out ? t('Kolda bir düğmeye bas') : t('Kolla ata')}`} onClick={() => setCapturing(capturing === out ? undefined : out)}>
              {capturing === out ? t('Kolda bir düğmeye bas') : t('Kolla ata')}
            </button>
          </div>
        ))}
      </div>
      {(value.buttonMap || value.swapSticks || value.invertY) && (
        <button className="ghost" data-nav onClick={() => onChange({ buttonMap: '', swapSticks: false, invertY: false })}>{t('Standart düzene dön')}</button>
      )}
    </div>
  )
}
