// Per-device conveniences only; storage can be unavailable, so never rely on it.
export function readSetting<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writeSetting(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Not worth surfacing: the choice just won't survive a restart.
  }
}
