import { Preferences } from '@capacitor/preferences'
import { DEFAULT_SETTINGS, sanitizeSettings, type AppSettings } from '../shared/settings'

const KEY = 'settings'

async function stored(): Promise<Partial<AppSettings>> {
  const { value } = await Preferences.get({ key: KEY })
  try {
    return value ? JSON.parse(value) : {}
  } catch {
    return {}
  }
}

// The phone apps go through Google's and Apple's review, and reporting another
// country to Microsoft conflicts with its terms: the region override stays off there.
export async function getSettings(): Promise<AppSettings> {
  return { ...DEFAULT_SETTINGS, ...sanitizeSettings(await stored()), xboxRegionIp: '' }
}

export async function setSettings(input: Partial<AppSettings>): Promise<AppSettings> {
  const patch = sanitizeSettings(input)
  delete patch.xboxRegionIp
  const next = { ...(await getSettings()), ...patch }
  await Preferences.set({ key: KEY, value: JSON.stringify(next) })
  return next
}

export async function resetSettings(): Promise<AppSettings> {
  await Preferences.set({ key: KEY, value: JSON.stringify(DEFAULT_SETTINGS) })
  return { ...DEFAULT_SETTINGS }
}
