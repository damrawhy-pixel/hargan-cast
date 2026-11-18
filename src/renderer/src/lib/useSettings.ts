import { useSyncExternalStore } from 'react'
import { DEFAULT_SETTINGS, type AppSettings } from '../../../shared/settings'
import { direction, getLanguage, resolveLanguage, setLanguage } from '../../../shared/i18n'

let current = DEFAULT_SETTINGS
const listeners = new Set<() => void>()

function applyLanguage(settings: AppSettings) {
  setLanguage(resolveLanguage(settings.language, navigator.language))
  document.documentElement.lang = getLanguage()
  document.documentElement.dir = direction()
}
applyLanguage(current)

// The desktop scales the page from the main process (setZoomFactor); phones have no
// such process, so the page scales itself. Same base size on both.
const BASE_FONT_PX = 15
// The living-room view: across the room on a TV or a Steam Deck in Game Mode,
// everything a quarter larger and the controller's focus unmistakable.
const LIVING_ROOM_SCALE = 1.25

export function livingRoom(settings: AppSettings) {
  if (settings.livingRoom !== 'auto') return settings.livingRoom === 'on'
  // Android tells a TV apart itself; a Steam Deck in Game Mode is told by the main process.
  return Boolean(window.hc.platform.television || window.hc.platform.gameMode)
}

function applyTextSize(settings: AppSettings) {
  const living = livingRoom(settings)
  document.documentElement.toggleAttribute('data-living-room', living)
  const scale = living ? LIVING_ROOM_SCALE : 1
  if (document.documentElement.dataset.platform === 'mobile') document.documentElement.style.setProperty('zoom', String((settings.fontSize / BASE_FONT_PX) * scale))
  else document.documentElement.style.setProperty('zoom', living ? String(scale) : '')
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
