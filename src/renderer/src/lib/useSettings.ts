import { useSyncExternalStore } from 'react'
import { DEFAULT_SETTINGS, type AppSettings } from '../../../shared/settings'

let current = DEFAULT_SETTINGS
const listeners = new Set<() => void>()

function publish(next: AppSettings) {
  current = next
  listeners.forEach((l) => l())
  return next
}

void window.hc.settings.get().then(publish)

export const getSettings = () => current

export const updateSettings = (patch: Partial<AppSettings>) => window.hc.settings.set(patch).then(publish)

export const resetSettings = () => window.hc.settings.reset().then(publish)

export function useSettings() {
  return useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, getSettings)
}
