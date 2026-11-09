import { useEffect, useRef } from 'react'

const SOURCE = 'https://github.com/damrawhy-pixel/hargan-cast'
const PRIVACY = `${SOURCE}/blob/main/docs/privacy.md`

export function About({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => ref.current?.showModal(), [])

  return (
    <dialog ref={ref} className="about" onClose={onClose}>
      <img className="about-logo" src="./logo-256.png" alt="Hargan Cast" />
      <p>© 2026 Hargan Cast</p>
      <p>Bu program AGPL-3.0 lisansıyla ve <strong>hiçbir garanti olmaksızın</strong> sunulur.</p>
      <p>Sony veya Microsoft ile ilişkili değildir. PlayStation ve Xbox ilgili sahiplerinin ticari markalarıdır.</p>
      <form method="dialog" className="about-actions">
        <button type="button" className="ghost" onClick={() => window.hc.platform.openLicenses()}>Lisanslar</button>
        <button type="button" className="ghost" onClick={() => window.hc.platform.openExternal(PRIVACY)}>Gizlilik</button>
        <button type="button" className="ghost" onClick={() => window.hc.platform.openExternal(SOURCE)}>Kaynak kod</button>
        <button className="primary">Kapat</button>
      </form>
    </dialog>
  )
}
