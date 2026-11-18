// More than one account per service: everything a service keeps in its vault
// (session tokens, linked consoles, cached ids) is the signed-in account. Other
// accounts wait on a shelf, in a vault of their own, and switching swaps the two.
// Nothing here may import Electron or Node, so the phone apps can bundle it.

export interface AccountVault {
  snapshot(): Record<string, unknown>
  replace(data: Record<string, unknown>): void
}

export interface Shelf {
  get<T>(key: string, fallback: T): T
  set(key: string, value: unknown): void
}

export interface SavedAccount {
  id: string
  label: string
}

interface Parked extends SavedAccount {
  data: Record<string, unknown>
}

const MAX_ACCOUNTS = 8

export class AccountShelf {
  constructor(private shelf: Shelf, private service: 'playstation' | 'xbox', private vault: AccountVault) {}

  private parked(): Parked[] {
    return this.shelf.get<Parked[]>(this.service, [])
  }

  list(): SavedAccount[] {
    return this.parked().map(({ id, label }) => ({ id, label }))
  }

  /** Puts the signed-in account on the shelf; the vault is left empty for the next sign-in. */
  park(label: string) {
    const data = this.vault.snapshot()
    if (!Object.keys(data).length) return
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    this.shelf.set(this.service, [...this.parked(), { id, label: label || '?', data }].slice(-MAX_ACCOUNTS))
    this.vault.replace({})
  }

  /** Swaps the signed-in account (if any) with a parked one. */
  swap(id: string, currentLabel: string) {
    const parked = this.parked()
    const next = parked.find((a) => a.id === id)
    if (!next) return false
    const current = this.vault.snapshot()
    const rest = parked.filter((a) => a.id !== id)
    if (Object.keys(current).length) rest.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, label: currentLabel || '?', data: current })
    this.shelf.set(this.service, rest)
    this.vault.replace(next.data)
    return true
  }

  forget(id: string) {
    this.shelf.set(this.service, this.parked().filter((a) => a.id !== id))
  }
}
