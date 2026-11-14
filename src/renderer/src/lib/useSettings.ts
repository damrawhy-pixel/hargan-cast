import { useSyncExternalStore } from 'react'
import { DEFAULT_SETTINGS, type AppSettings } from '../../../shared/settings'
import { getLanguage, resolveLanguage, setLanguage } from '../../../shared/i18n'

let current = DEFAULT_SETTINGS
const listeners = new Set<() => void>()

function applyLanguage(settings: AppSettings) {
  setLanguage(resolveLanguage(settings.language, navigator.language))
  document.documentElement.lang = getLanguage()
}
applyLanguage(current)

// The desktop scales the page from the main process (setZoomFactor); phones have no
// such process, so the page scales itself. Same base size on both.
const BASE_FONT_PX = 15
function applyTextSize(settings: AppSettings) {
  if (document.documentElement.dataset.platform !== 'mobile') return
  document.documentElement.style.setProperty('zoom', String(settings.fontSize / BASE_FONT_PX))
}

function publish(next: AppSettings) {
  current = next
  applyLanguage(next)
  applyTextSize(next)
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
