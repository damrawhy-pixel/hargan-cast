import { Library, SkeletonGrid, type LibraryFilter } from '../components/Library'
import { SignIn } from '../components/SignIn'
import type { HubItem } from '../lib/items'
import { loadXbox, useStore } from '../lib/store'
import { t } from '../../../shared/i18n'
import type { XboxConsole, XboxTitle } from '../../../shared/types'
import { useCallback, useEffect, useState } from 'react'
import { Friends } from './Friends'

const filters = (favorites: Set<string>): LibraryFilter[] => [
  // Everything this account can start right now, however it got access.
  { id: 'owned', label: t('Sahip olduklarım'), test: (i) => i.action === 'play' },
  // Second, so the library still opens on what can be played.
  { id: 'favorites', label: t('Favoriler'), test: (i) => favorites.has(i.key) },
  { id: 'gamepass', label: 'Game Pass', test: (i) => i.action === 'play' && !i.xbox?.owned },
  { id: 'recent', label: t('Son oynananlar'), test: (i) => Boolean(i.xbox?.recent || i.xbox?.lastPlayed) },
  { id: 'all', label: t('Tümü'), test: () => true },
]

interface Props {
  onOpen(item: HubItem, art: HTMLElement | null): void
  onOpenSettings(): void
  onPlayConsole(title: XboxTitle): void
}

/** A console as something XboxStream can play. */
export const consoleTitle = (c: XboxConsole): XboxTitle => ({ titleId: `home:${c.serverId}`, productId: '', name: c.name, categories: [], recent: false, home: c.serverId })

const POWER: Record<string, Parameters<typeof t>[0]> = { On: 'Açık', ConnectedStandby: 'Hızlı başlatmada bekliyor', Off: 'Kapalı' }

/** The account's own Xboxes that allow remote play; Microsoft relays the stream. */
function XboxConsoles({ onPlay }: { onPlay(title: XboxTitle): void }) {
  const [consoles, setConsoles] = useState<XboxConsole[]>([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(() => {
    setLoading(true)
    void window.hc.xbox.consoles().then(setConsoles).catch(() => setConsoles([])).finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])
  if (!loading && consoles.length === 0) return null
  return (
    <section className="consoles">
      <div className="shelf-head">
        <h2>{t('Konsolların')}</h2>
        <button className="ghost" data-nav disabled={loading} onClick={load}>{loading ? t('Aranıyor') : t('Yenile')}</button>
      </div>
      <div className="console-list">
        {consoles.map((c) => (
          <div className="console-card glass" key={c.serverId}>
            <strong>{c.name}</strong>
            <small>{c.type.replace(/^Xbox/, 'Xbox ')} · {t(POWER[c.powerState] ?? 'Durumu bilinmiyor')}</small>
            {!c.streamingEnabled && <small>{t('Konsolda Ayarlar > Cihazlar ve bağlantılar > Uzak özellikler açık olmalı.')}</small>}
            <div className="console-actions">
              <button
                className="primary"
                data-nav
                disabled={!c.streamingEnabled || c.powerState === 'Off'}
                onClick={() => onPlay(consoleTitle(c))}
              >
                {t('Oyna')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function XboxSpace({ onOpen, onOpenSettings, onPlayConsole }: Props) {
  const status = useStore((s) => s.xbox)
  const items = useStore((s) => s.xboxItems)
  const loading = useStore((s) => s.xboxLoading)
  const error = useStore((s) => s.xboxError)
  const favoriteKeys = useStore((s) => s.favorites)

  if (status.state !== 'signedIn') {
    return (
      <SignIn
        service="Xbox"
        state={status.state}
        error={status.error}
        lines={[t('Giriş Microsoft’un kendi penceresinde yapılır, şifren bu uygulamaya hiç uğramaz.')]}
        onSignIn={() => void window.hc.xbox.signIn()}
      />
    )
  }

  return (
    <div className="space-body">
      {!status.hasCloud && (
        <div className="banner banner--info" role="status">
          <span>
            {status.cloudError?.includes('InvalidCountry')
              ? t("Microsoft, Cloud Gaming'i bulunduğun ülkede sunmuyor. Oyun kütüphanen görünür ama akış başlatılamaz.")
              : t('Bulut oyun erişimi yok. Oyun kütüphanen görünür ama akış başlatılamaz.')}
          </span>
          <button className="ghost" data-nav onClick={onOpenSettings}>{t('Ayarlar')}</button>
        </div>
      )}
      {error && <p className="banner" role="alert">{error}</p>}
      <XboxConsoles onPlay={onPlayConsole} />
      <Friends />
      {items.length === 0 && loading ? (
        <SkeletonGrid />
      ) : (
        <Library
          title={t('Xbox kitaplığı')}
          items={items}
          filters={filters(new Set(favoriteKeys))}
          onOpen={onOpen}
          toolbar={<button className="ghost" data-nav disabled={loading} onClick={loadXbox}>{t('Yenile')}</button>}
        />
      )}
    </div>
  )
}
