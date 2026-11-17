import { useEffect, useState } from 'react'
import type { XboxAchievements } from '../../../shared/types'
import { locale, t } from '../../../shared/i18n'

/** The account's achievements in one Xbox game: a summary line, then the list. */
export function Achievements({ productId, titleId, compact }: { productId: string; titleId: string; compact?: boolean }) {
  const [data, setData] = useState<XboxAchievements | null>()
  const [open, setOpen] = useState(!compact)
  useEffect(() => {
    let current = true
    window.hc.xbox
      .achievements(productId, titleId)
      .then((d) => current && setData(d))
      .catch(() => current && setData(null))
    return () => {
      current = false
    }
  }, [productId, titleId])

  if (data === undefined) return <p className="achievements-note">{t('Başarımlar yükleniyor')}</p>
  if (data === null) return <p className="achievements-note">{t('Bu oyunda başarım yok ya da henüz oynanmadı.')}</p>
  const percent = Math.round((data.unlocked / data.total) * 100)
  return (
    <div className="achievements">
      <button className="achievements-summary ghost" data-nav aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{t('Başarımlar')}</span>
        <b>{data.unlocked}/{data.total}</b>
        <span>{data.gamerscore}/{data.totalGamerscore} G</span>
        <span className="achievements-bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
      </button>
      {open && (
        <ul className="achievements-list">
          {data.list.map((a) => (
            <li key={a.id} className={a.unlocked ? 'unlocked' : undefined}>
              {a.icon && !a.secret ? <img src={a.icon} alt="" loading="lazy" /> : <span className="achievements-icon" aria-hidden="true">{a.unlocked ? '★' : '?'}</span>}
              <div>
                <strong>{a.secret ? t('Gizli başarım') : a.name}</strong>
                <small>{a.secret ? t('Açılınca görünür.') : a.description}</small>
                {a.unlocked && a.unlockedAt && <small>{new Date(a.unlockedAt).toLocaleDateString(locale())}</small>}
                {a.progress !== undefined && (
                  <span className="achievements-bar" aria-label={`%${a.progress}`}><span style={{ width: `${a.progress}%` }} /></span>
                )}
              </div>
              <b>{a.gamerscore} G</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
