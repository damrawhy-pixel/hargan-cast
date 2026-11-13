import { Library, SkeletonGrid, type LibraryFilter } from '../components/Library'
import { SignIn } from '../components/SignIn'
import type { HubItem } from '../lib/items'
import { loadXbox, useStore } from '../lib/store'
import { t } from '../../../shared/i18n'

const filters = (): LibraryFilter[] => [
  // Everything this account can start right now, however it got access.
  { id: 'owned', label: t('Sahip olduklarım'), test: (i) => i.action === 'play' },
  { id: 'gamepass', label: 'Game Pass', test: (i) => i.action === 'play' && !i.xbox?.owned },
  { id: 'recent', label: t('Son oynananlar'), test: (i) => Boolean(i.xbox?.recent || i.xbox?.lastPlayed) },
  { id: 'all', label: t('Tümü'), test: () => true },
]

interface Props {
  onOpen(item: HubItem, art: HTMLElement | null): void
  onOpenSettings(): void
}

export function XboxSpace({ onOpen, onOpenSettings }: Props) {
  const status = useStore((s) => s.xbox)
  const items = useStore((s) => s.xboxItems)
  const loading = useStore((s) => s.xboxLoading)
  const error = useStore((s) => s.xboxError)

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
      {items.length === 0 && loading ? (
        <SkeletonGrid />
      ) : (
        <Library
          title={t('Xbox kitaplığı')}
          items={items}
          filters={filters()}
          onOpen={onOpen}
          toolbar={<button className="ghost" data-nav disabled={loading} onClick={loadXbox}>{t('Yenile')}</button>}
        />
      )}
    </div>
  )
}
