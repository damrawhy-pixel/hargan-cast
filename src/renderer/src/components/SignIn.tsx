import type { ReactNode } from 'react'
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
          {state === 'restoring' ? 'Oturum açılıyor' : state === 'signingIn' ? 'Giriş penceresi açık' : `${service} ile giriş yap`}
        </button>
        {children}
      </div>
    </section>
  )
}
