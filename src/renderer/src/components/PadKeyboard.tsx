import { useEffect, useRef, useState } from 'react'
import { getLanguage, locale, t } from '../../../shared/i18n'
import { connectedPads } from '../lib/gamepads'

// A keyboard for the controller: pressing A on a text field while steering with a
// pad opens it, so addresses, PINs and sign-in codes can be typed from the couch,
// a TV or a Steam Deck. The keys are ordinary focusable buttons, so the app's own
// pad navigation moves between them; X deletes, Y switches case, Menu finishes.

const ROWS: Record<'tr' | 'en', string[]> = {
  tr: ['1234567890', 'qwertyuıopğü', 'asdfghjklşi', 'zxcvbnmöç', '.-_@:/'],
  en: ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '.-_@:/'],
}
const PAD_X = 2
const PAD_Y = 3
const PAD_MENU = 9

type Field = HTMLInputElement | HTMLTextAreaElement

const isTextField = (el: EventTarget | null): el is Field =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && ['text', 'password', 'search', 'email', 'url', 'tel', 'number', ''].includes(el.type))

/** Sets a field's value the way typing would, so React's own state follows. */
export function typeInto(field: Field, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

export function PadKeyboard() {
  const [field, setField] = useState<Field>()
  const [upper, setUpper] = useState(false)
  const [, redraw] = useState(0)
  const root = useRef<HTMLDivElement>(null)

  // Opens on a pad's A press on a text field; the app marks pad use on <html>.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (document.documentElement.dataset.input === 'pad' && isTextField(e.target) && !e.target.readOnly && !e.target.disabled) setField(e.target)
    }
    window.addEventListener('click', onClick, true)
    return () => window.removeEventListener('click', onClick, true)
  }, [])

  useEffect(() => {
    if (field) root.current?.querySelector<HTMLElement>('[data-nav]')?.focus()
  }, [field])

  // Typing goes on at the end: the field is not focused while the keys are, so it has no caret to follow.
  const insert = (text: string) => {
    if (!field) return
    const next = field.value + text
    if (field.maxLength > 0 && next.length > field.maxLength) return
    typeInto(field, next)
    redraw((n) => n + 1)
  }
  const erase = () => {
    if (!field) return
    typeInto(field, [...field.value].slice(0, -1).join(''))
    redraw((n) => n + 1)
  }
  const close = (submit = false) => {
    const target = field
    setField(undefined)
    setUpper(false)
    target?.focus()
    if (submit) target?.form?.requestSubmit()
  }

  // X, Y and Menu act on the keyboard directly; the app's navigation handles the rest.
  const actions = useRef({ erase, toggle: () => setUpper((u) => !u), close })
  useEffect(() => {
    actions.current = { erase, toggle: () => setUpper((u) => !u), close }
  })
  useEffect(() => {
    if (!field) return
    const held: Record<number, boolean> = {}
    let frame = 0
    const poll = () => {
      frame = requestAnimationFrame(poll)
      const pad = connectedPads()[0]
      if (!pad) return
      for (const [index, act] of [[PAD_X, () => actions.current.erase()], [PAD_Y, () => actions.current.toggle()], [PAD_MENU, () => actions.current.close(true)]] as const) {
        const down = pad.buttons[index]?.pressed ?? false
        if (down && !held[index]) act()
        held[index] = down
      }
    }
    frame = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(frame)
  }, [field])

  if (!field) return null
  const rows = ROWS[getLanguage() === 'tr' ? 'tr' : 'en']
  const shown = field instanceof HTMLInputElement && field.type === 'password' ? '•'.repeat(field.value.length) : field.value
  const key = (c: string) => (upper ? c.toLocaleUpperCase(locale()) : c)
  return (
    <div className="pad-keyboard glass" ref={root} role="dialog" aria-label={t('Ekran klavyesi')}>
      <output className="pad-keyboard-text">{shown || <span>{field.placeholder}</span>}</output>
      {rows.map((row) => (
        <div className="pad-keyboard-row" key={row}>
          {[...row].map((c) => (
            <button key={c} data-nav onClick={() => insert(key(c))}>{key(c)}</button>
          ))}
        </div>
      ))}
      <div className="pad-keyboard-row pad-keyboard-actions">
        <button data-nav aria-pressed={upper} onClick={() => setUpper((u) => !u)}>{t('Büyük harf')} (Y)</button>
        <button data-nav className="pad-keyboard-space" onClick={() => insert(' ')}>{t('Boşluk')}</button>
        <button data-nav onClick={erase}>{t('Sil')} (X)</button>
        <button data-nav className="primary" onClick={() => close(true)}>{t('Bitti')} (Menu)</button>
        <button data-nav data-back onClick={() => close()}>{t('Kapat')} (B)</button>
      </div>
    </div>
  )
}
