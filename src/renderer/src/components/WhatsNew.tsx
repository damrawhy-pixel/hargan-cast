import { useEffect, useRef, useState } from 'react'
import { t } from '../../../shared/i18n'
import { readSetting, writeSetting } from '../lib/settings'
import { changesSince } from '../lib/whatsNew'

const SEEN = 'seenVersion'

/** After an update, once: what the new version brought. A fresh install shows nothing. */
export function WhatsNew() {
  const [releases] = useState(() => {
    const seen = readSetting<string>(SEEN, '')
    writeSetting(SEEN, __APP_VERSION__)
    return seen ? changesSince(seen, __APP_VERSION__) : []
  })
  const [open, setOpen] = useState(releases.length > 0)
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open) ref.current?.showModal()
  }, [open])
  if (!open) return null
  return (
    <dialog ref={ref} className="about whats-new" onClose={() => setOpen(false)}>
      <h2>{t('Yenilikler')}</h2>
      {releases.map((r) => (
        <section key={r.version}>
          <h3>Hargan Cast {r.version}</h3>
          <ul>{r.items.map((item) => <li key={item}>{t(item)}</li>)}</ul>
        </section>
      ))}
      <form method="dialog" className="about-actions">
        <button className="primary" data-nav autoFocus>{t('Tamam')}</button>
      </form>
    </dialog>
  )
}
