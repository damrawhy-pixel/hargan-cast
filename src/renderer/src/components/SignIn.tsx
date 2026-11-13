import type { ReactNode } from 'react'
import { t } from '../../../shared/i18n'
import type { AccountState } from '../../../shared/types'

interface Props {
  service: string
  state: AccountState
  lines: string[]
  error?: string
  onSignIn(): void
  children?: ReactNode
}

export function SignIn({ service, state, lines, error, onSignIn, children }: Props) {
  const busy = state === 'signingIn' || state === 'restoring'
  return (
    <section className="signin">
      <div className="signin-card glass">
        <img className="signin-logo" src="./logo-256.png" alt="" />
        <h1>{service}</h1>
        {lines.map((line) => <p key={line}>{line}</p>)}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary big" data-nav disabled={busy} onClick={onSignIn}>
          {state === 'restoring' ? t('Oturum açılıyor') : state === 'signingIn' ? t('Giriş penceresi açık') : t('{service} ile giriş yap', { service })}
        </button>
        {children}
      </div>
    </section>
  )
}
