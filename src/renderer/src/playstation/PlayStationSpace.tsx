import { useMemo, useState } from 'react'
import { Library, SkeletonGrid, type LibraryFilter } from '../components/Library'
import { SignIn } from '../components/SignIn'
import type { HubItem } from '../lib/items'
import { loadPlayStation, useStore } from '../lib/store'
import { useSettings } from '../lib/useSettings'

const TOKEN_PAGE = 'https://ca.account.sony.com/api/v1/ssocookie'

// The catalog cannot say whether the account is subscribed, so that comes from the user.
const buildFilters = (premium: boolean): LibraryFilter[] => [
  { id: 'owned', label: 'Sahip olduklarım', test: (i) => Boolean(i.ps?.isOwned) || (premium && i.action === 'play') },
  { id: 'catalog', label: 'Akış kataloğu', test: (i) => i.action === 'play' },
  { id: 'free', label: 'Ücretsiz', test: (i) => Boolean(i.ps?.freeToPlay) },
  { id: 'plus', label: 'PS Plus', test: (i) => Boolean(i.ps?.plusCatalog) },
  { id: 'ps5', label: 'PS5', test: (i) => i.ps?.platform === 'ps5' },
  { id: 'all', label: 'Tümü', test: () => true },
]

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

interface Props {
  onOpen(item: HubItem, art: HTMLElement | null): void
}

export function PlayStationSpace({ onOpen }: Props) {
  const status = useStore((s) => s.ps)
  const catalog = useStore((s) => s.psCatalog)
  const items = useStore((s) => s.psItems)
  const loading = useStore((s) => s.psLoading)
  const error = useStore((s) => s.psError)
  const { psPremium } = useSettings()
  const filters = useMemo(() => buildFilters(psPremium), [psPremium])
  const [token, setToken] = useState('')
  const [tokenError, setTokenError] = useState<string>()

  if (status.state !== 'signedIn') {
    return (
      <SignIn
        service="PlayStation"
        state={status.state}
        error={status.error}
        lines={['Giriş Sony’nin kendi penceresinde yapılır, şifren bu uygulamaya hiç uğramaz.']}
        onSignIn={() => void window.hc.ps.signIn()}
      >
        <details className="fallback">
          <summary>Pencere çalışmıyor mu? Tarayıcıyla bağlan</summary>
          <ol>
            <li>Normal tarayıcında Sony hesabına giriş yap.</li>
            <li><button className="link" onClick={() => window.hc.platform.openExternal(TOKEN_PAGE)}>Token sayfasını aç</button> ve çıkan metni kopyala.</li>
            <li>Aşağıya yapıştır. Bu değer şifre gibidir, kimseyle paylaşma.</li>
          </ol>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              window.hc.ps.signInWithToken(token).catch((err: Error) => setTokenError(clean(err)))
            }}
          >
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="NPSSO" />
            <button className="ghost" disabled={!token}>Bağlan</button>
          </form>
          {tokenError && <p className="error" role="alert">{tokenError}</p>}
        </details>
      </SignIn>
    )
  }

  return (
    <div className="space-body">
      {(catalog?.warning || error) && <p className="banner" role="alert">{error ?? catalog?.warning}</p>}
      {!catalog && loading ? (
        <SkeletonGrid />
      ) : (
        <Library
          items={items}
          filters={filters}
          onOpen={onOpen}
          toolbar={<button className="ghost" data-nav disabled={loading} onClick={() => loadPlayStation(true)}>Yenile</button>}
        />
      )}
    </div>
  )
}
