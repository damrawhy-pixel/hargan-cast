// The desktop keeps account data in DPAPI-encrypted files. On a phone the app's
// own sandbox protects it, so the same get/set/delete shape sits on localStorage.

const PREFIX = 'hc-vault:'

export default class SecureStore {
  constructor(private name = 'xbox') {}

  private read(): Record<string, unknown> {
    try {
      return JSON.parse(localStorage.getItem(PREFIX + this.name) ?? '{}')
    } catch {
      return {}
    }
  }

  private write(data: Record<string, unknown>) {
    localStorage.setItem(PREFIX + this.name, JSON.stringify(data))
  }

  get<T = any>(key: string, fallback?: T): T {
    const value = this.read()[key]
    return (value === undefined ? fallback : value) as T
  }

  set(key: string, value: unknown) {
    const data = this.read()
    // Round-trip so class instances are stored as plain data.
    data[key] = JSON.parse(JSON.stringify(value))
    this.write(data)
  }

  delete(key: string) {
    const data = this.read()
    delete data[key]
    this.write(data)
  }

  clear() {
    localStorage.removeItem(PREFIX + this.name)
  }
}
