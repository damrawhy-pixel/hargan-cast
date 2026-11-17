import { useCallback, useEffect, useState } from 'react'
import type { PsConsole, PsFoundConsole } from '../../../shared/types'
import { t } from '../../../shared/i18n'

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
// After a wake the console takes a while to come up; look for it this often, this long.
const WAKE_POLL_MS = 3000
const WAKE_WAIT_MS = 45_000

const kind = (ps5: boolean) => (ps5 ? 'PS5' : 'PS4')

function stateText(found?: PsFoundConsole) {
  if (!found) return t('Ağda görünmüyor')
  if (found.state === 'ready') return found.runningApp ? t('Açık · {app}', { app: found.runningApp }) : t('Açık')
  if (found.state === 'standby') return t('Dinlenme modunda')
  return t('Durumu bilinmiyor')
}

function LinkPanel({ found, onLinked, onCancel }: { found: PsFoundConsole; onLinked(c: PsConsole): void; onCancel(): void }) {
  const [pin, setPin] = useState('')
  const [account, setAccount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const link = async () => {
    setBusy(true)
    setError(undefined)
    try {
      onLinked(await window.hc.ps.consoles!.register(found, pin, account || undefined))
    } catch (e) {
      setError(clean(e as Error))
    }
    setBusy(false)
  }
  return (
    <form
      className="console-link glass"
      onSubmit={(e) => {
        e.preventDefault()
        void link()
      }}
    >
      <h3>{t('{name} ile bağla', { name: found.name || kind(found.ps5) })}</h3>
      <ol>
        <li>{found.ps5 ? t('Konsolda Ayarlar > Sistem > Uzaktan Oynatma > Cihaz Bağla seçeneğini aç.') : t('Konsolda Ayarlar > Uzaktan Oynatma Bağlantı Ayarları > Cihaz Ekle seçeneğini aç.')}</li>
        <li>{t('Ekranda görünen 8 haneli PIN’i buraya yaz.')}</li>
      </ol>
      <input inputMode="numeric" autoComplete="off" maxLength={9} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="1234 5678" aria-label="PIN" data-nav autoFocus />
      <details>
        <summary>{t('Gelişmiş')}</summary>
        <label className="profile-row">
          <span>{t('PSN hesap kimliği (base64)')}</span>
          <input autoComplete="off" value={account} onChange={(e) => setAccount(e.target.value)} placeholder={t('Boş bırakılırsa girişten alınır')} data-nav />
        </label>
      </details>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="console-actions">
        <button className="primary" data-nav disabled={busy || pin.replace(/\D/g, '').length !== 8}>{busy ? t('Bağlanıyor') : t('Bağla')}</button>
        <button type="button" className="ghost" data-nav onClick={onCancel}>{t('Vazgeç')}</button>
      </div>
    </form>
  )
}

/**
 * The user's own consoles: linked ones to play, wake or remove, and the ones on
 * the network that can be linked with the PIN the console shows.
 */
export function Consoles({ onPlay }: { onPlay(console: PsConsole): void }) {
  const api = window.hc.ps.consoles
  const [linked, setLinked] = useState<PsConsole[]>([])
  const [found, setFound] = useState<PsFoundConsole[]>([])
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState(false)
  const [address, setAddress] = useState('')
  const [linking, setLinking] = useState<PsFoundConsole>()
  const [waking, setWaking] = useState<string>()
  const [error, setError] = useState<string>()

  const search = useCallback(
    async (host?: string) => {
      if (!api) return []
      setSearching(true)
      try {
        const list = await api.discover(host)
        setFound((old) => (host ? [...old.filter((f) => !list.some((n) => n.hostId === f.hostId)), ...list] : list))
        // A linked console that turns up at a new address (DHCP moved it) follows it.
        const consoles = await api.list()
        for (const c of consoles) {
          const at = list.find((f) => f.hostId === c.id)
          if (at && at.address !== c.address) await api.moved(c.id, at.address)
        }
        setLinked(await api.list())
        return list
      } catch (e) {
        setError(clean(e as Error))
        return []
      } finally {
        setSearching(false)
      }
    },
    [api],
  )

  useEffect(() => {
    if (!api) return
    void api.list().then(setLinked)
    void search()
  }, [api, search])

  if (!api) return null

  const wake = async (c: PsConsole) => {
    setWaking(c.id)
    setError(undefined)
    try {
      await api.wake(c.id)
      const until = Date.now() + WAKE_WAIT_MS
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, WAKE_POLL_MS))
        const list = await search()
        if (list.find((f) => f.hostId === c.id)?.state === 'ready') break
      }
    } catch (e) {
      setError(clean(e as Error))
    }
    setWaking(undefined)
  }

  const forget = async (c: PsConsole) => setLinked(await api.forget(c.id))
  const unlinked = found.filter((f) => !linked.some((c) => c.id === f.hostId))

  return (
    <section className="consoles">
      <div className="shelf-head">
        <h2>{t('Konsolların')}</h2>
        <button className="ghost" data-nav disabled={searching} onClick={() => void search()}>{searching ? t('Aranıyor') : t('Ağda ara')}</button>
        <button className="ghost" data-nav onClick={() => setAdding((a) => !a)}>{t('Konsol ekle')}</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {linked.length === 0 && !adding && <p className="hint">{t('Kendi PS5 ya da PS4’ünü bağla; oyunlarını PS Plus olmadan, evdeki ağ hızında oyna.')}</p>}

      <div className="console-list">
        {linked.map((c) => {
          const here = found.find((f) => f.hostId === c.id)
          return (
            <div className="console-card glass" key={c.id}>
              <strong>{c.name}</strong>
              <small>{kind(c.ps5)} · {c.address} · {stateText(here)}</small>
              <div className="console-actions">
                <button className="primary" data-nav disabled={here?.state === 'standby'} onClick={() => onPlay(c)}>{t('Oyna')}</button>
                {here?.state !== 'ready' && (
                  <button className="ghost" data-nav disabled={waking === c.id} onClick={() => void wake(c)}>{waking === c.id ? t('Uyandırılıyor') : t('Uyandır')}</button>
                )}
                <button className="ghost danger" data-nav onClick={() => void forget(c)}>{t('Kaldır')}</button>
              </div>
            </div>
          )
        })}
      </div>

      {adding && !linking && (
        <div className="console-add glass">
          <p>{t('Bilgisayarla aynı ağdaki konsollar:')}</p>
          {unlinked.length === 0 && <p className="hint">{searching ? t('Aranıyor') : t('Bulunamadı. Konsol açık mı ve Uzaktan Oynatma etkin mi?')}</p>}
          {unlinked.map((f) => (
            <button key={f.hostId || f.address} className="ghost" data-nav onClick={() => setLinking(f)}>
              {f.name || kind(f.ps5)} · {kind(f.ps5)} · {f.address}
            </button>
          ))}
          <form
            className="console-address"
            onSubmit={(e) => {
              e.preventDefault()
              void search(address).then((list) => {
                if (!list.length) setError(t('Bu adreste konsol yanıt vermedi.'))
              })
            }}
          >
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t('Adres, örneğin 192.168.1.20')} aria-label={t('Konsol adresi')} data-nav />
            <button className="ghost" data-nav disabled={!address.trim() || searching}>{t('Bu adreste ara')}</button>
          </form>
        </div>
      )}

      {linking && (
        <LinkPanel
          found={linking}
          onCancel={() => setLinking(undefined)}
          onLinked={(c) => {
            setLinking(undefined)
            setAdding(false)
            setLinked((old) => [...old.filter((o) => o.id !== c.id), c])
          }}
        />
      )}
    </section>
  )
}
