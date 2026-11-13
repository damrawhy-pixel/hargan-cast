// The desktop keeps account data in DPAPI-encrypted files. On a phone it lives in
// the platform's own key store: encrypted with an Android Keystore key, or kept
// in the iOS Keychain (mobile/plugins/ps-core). The Xbox and PlayStation layers
// read it synchronously, so the whole vault is loaded once at start-up
// (loadVaults, before any service) and every change is written back behind them.
import { PsCore } from '../native'

type Vaults = Record<string, Record<string, unknown>>

/** Where versions before the key store kept the vault, in the web view's storage. */
const LEGACY_PREFIX = 'hc-vault:'

let vaults: Vaults = {}
let saving: Promise<void> = Promise.resolve()
let dirty = false

function legacyVaults(): Vaults {
  const found: Vaults = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(LEGACY_PREFIX)) continue
      try {
        found[key.slice(LEGACY_PREFIX.length)] = JSON.parse(localStorage.getItem(key) ?? '{}')
      } catch {
        // An unreadable entry is dropped; the account signs in again.
      }
    }
  } catch {
    // No web storage: nothing to move.
  }
  return found
}

function forgetLegacy() {
  try {
    for (const name of Object.keys(legacyVaults())) localStorage.removeItem(LEGACY_PREFIX + name)
  } catch {
    // Nothing to remove.
  }
}

// Writes are coalesced: a burst of token updates becomes one save of the latest state.
function scheduleSave() {
  if (dirty) return
  dirty = true
  saving = saving.then(async () => {
    dirty = false
    await PsCore.vaultSave({ data: JSON.stringify(vaults) }).catch(() => {
      // The key store refused: the session still works until the app closes.
    })
  })
}

/** Reads the vault from the key store, moving an older copy out of web storage once. */
export async function loadVaults() {
  const stored = await PsCore.vaultLoad().catch(() => ({ data: undefined }))
  if (stored.data) {
    try {
      vaults = JSON.parse(stored.data)
    } catch {
      vaults = {}
    }
    forgetLegacy()
    return
  }
  vaults = legacyVaults()
  if (Object.keys(vaults).length === 0) return
  await PsCore.vaultSave({ data: JSON.stringify(vaults) })
    .then(forgetLegacy)
    .catch(() => {
      // Keep the old copy until a save succeeds.
    })
}

/** Resolves once every change so far has reached the key store. */
export const vaultsSaved = () => saving

export default class SecureStore {
  constructor(private name = 'xbox') {}

  private data() {
    return (vaults[this.name] ??= {})
  }

  get<T = any>(key: string, fallback?: T): T {
    const value = this.data()[key]
    return (value === undefined ? fallback : value) as T
  }

  set(key: string, value: unknown) {
    // Round-trip so class instances are stored as plain data.
    this.data()[key] = JSON.parse(JSON.stringify(value))
    scheduleSave()
  }

  delete(key: string) {
    delete this.data()[key]
    scheduleSave()
  }

  clear() {
    delete vaults[this.name]
    scheduleSave()
  }
}
