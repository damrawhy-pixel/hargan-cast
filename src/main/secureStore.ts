import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { log } from './log'

interface Vault {
  data: Record<string, unknown>
  file: string
}

const vaults = new Map<string, Vault>()

function read(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))
  } catch (e) {
    if (fs.existsSync(file)) log(`vault unreadable: ${path.basename(file)} (${(e as Error).message})`)
    return undefined
  }
}

function open(name: string): Vault {
  const existing = vaults.get(name)
  if (existing) return existing

  const dir = path.join(app.getPath('userData'), 'vault')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.bin`)

  const vault = { data: read(file) ?? read(`${file}.bak`) ?? {}, file }
  vaults.set(name, vault)
  return vault
}

function persist(vault: Vault) {
  // Without OS encryption tokens stay in memory: re-login beats plaintext on disk.
  if (!safeStorage.isEncryptionAvailable()) return

  const json = JSON.stringify(vault.data)
  const encrypted = safeStorage.encryptString(json)
  const tmp = `${vault.file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, encrypted)

  // Only a copy proven readable may replace the last good one.
  if (read(tmp) === undefined || safeStorage.decryptString(fs.readFileSync(tmp)) !== json) {
    log(`vault write failed verification: ${path.basename(vault.file)}`)
    fs.rmSync(tmp, { force: true })
    return
  }
  if (read(vault.file) !== undefined) fs.copyFileSync(vault.file, `${vault.file}.bak`)
  fs.renameSync(tmp, vault.file)
}

// Each account space gets its own DPAPI-encrypted file. Same get/set/delete
// shape as electron-store, which the Xbox layer was written against.
export default class SecureStore {
  constructor(private name = 'xbox') {}

  get<T = any>(key: string, fallback?: T): T {
    const value = open(this.name).data[key]
    return (value === undefined ? fallback : value) as T
  }

  set(key: string, value: unknown) {
    const vault = open(this.name)
    // Round-trip so class instances are stored as plain data.
    vault.data[key] = JSON.parse(JSON.stringify(value))
    persist(vault)
  }

  delete(key: string) {
    const vault = open(this.name)
    delete vault.data[key]
    persist(vault)
  }

  clear() {
    const vault = open(this.name)
    vault.data = {}
    fs.rmSync(vault.file, { force: true })
    fs.rmSync(`${vault.file}.bak`, { force: true })
  }
}
