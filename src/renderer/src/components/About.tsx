import { useEffect, useRef } from 'react'
import { t } from '../../../shared/i18n'

const SOURCE = 'https://github.com/damrawhy-pixel/hargan-cast'
const PRIVACY = `${SOURCE}/blob/main/docs/privacy.md`

export function About({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => ref.current?.showModal(), [])

  return (
    <dialog ref={ref} className="about" onClose={onClose}>
      <img className="about-logo" src="./logo-256.png" alt="Hargan Cast" />
      <p>© 2026 Hargan Cast</p>
      <p>{t('Bu program AGPL-3.0 lisansıyla ve hiçbir garanti olmaksızın sunulur.')}</p>
      <p>{t('Sony veya Microsoft ile ilişkili değildir. PlayStation ve Xbox ilgili sahiplerinin ticari markalarıdır.')}</p>
      <form method="dialog" className="about-actions">
        <button type="button" className="ghost" onClick={() => window.hc.platform.openLicenses()}>{t('Lisanslar')}</button>
        <button type="button" className="ghost" onClick={() => window.hc.platform.openExternal(PRIVACY)}>{t('Gizlilik')}</button>
        <button type="button" className="ghost" onClick={() => window.hc.platform.openExternal(SOURCE)}>{t('Kaynak kod')}</button>
        <button className="primary">{t('Kapat')}</button>
      </form>
    </dialog>
  )
}
