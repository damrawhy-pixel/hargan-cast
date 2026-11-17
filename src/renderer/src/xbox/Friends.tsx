import { useEffect, useState } from 'react'
import type { XboxFriend } from '../../../shared/types'
import { t } from '../../../shared/i18n'

const REFRESH_MS = 60_000
const SHOWN = 24

/** Xbox friends, the ones online first, refreshed every minute while shown. */
export function Friends() {
  const [friends, setFriends] = useState<XboxFriend[]>()
  useEffect(() => {
    let current = true
    const load = () =>
      window.hc.xbox
        .friends()
        .then((list) => current && setFriends(list))
        .catch(() => current && setFriends([]))
    void load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [])
  if (!friends?.length) return null
  const online = friends.filter((f) => f.online).length
  return (
    <section className="friends">
      <div className="shelf-head">
        <h2>{t('Arkadaşların')}</h2>
        <small>{t('{n} çevrimiçi', { n: online })}</small>
      </div>
      <div className="friends-row">
        {friends.slice(0, SHOWN).map((f) => (
          <div key={f.xuid} className={`friend ${f.online ? 'friend--online' : ''}`} title={f.status}>
            {f.picture ? <img src={f.picture} alt="" loading="lazy" /> : <span className="friend-pic" aria-hidden="true">{f.gamertag.slice(0, 1)}</span>}
            <strong>{f.gamertag}</strong>
            <small>{f.status}</small>
          </div>
        ))}
      </div>
    </section>
  )
}
