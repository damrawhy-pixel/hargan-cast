import { Preferences } from '@capacitor/preferences'
import { DEFAULT_SETTINGS, sanitizeSettings, type AppSettings } from '../shared/settings'

const KEY = 'settings'
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
const IPV6 = /^[0-9a-f:]+$/i

async function stored(): Promise<Partial<AppSettings>> {
  const { value } = await Preferences.get({ key: KEY })
  try {
    return value ? JSON.parse(value) : {}
  } catch {
    return {}
  }
}

export async function getSettings(): Promise<AppSettings> {
  return { ...DEFAULT_SETTINGS, ...sanitizeSettings(await stored()) }
}

export async function setSettings(input: Partial<AppSettings>): Promise<AppSettings> {
  const patch = sanitizeSettings(input)
  if (patch.xboxRegionIp !== undefined) {
    patch.xboxRegionIp = patch.xboxRegionIp.trim()
    // Goes straight into an HTTP header, so only a bare address may pass.
    if (patch.xboxRegionIp && !IPV4.test(patch.xboxRegionIp) && !(patch.xboxRegionIp.includes(':') && IPV6.test(patch.xboxRegionIp)))
      throw new Error('Geçerli bir IP adresi gir')
  }
  const next = { ...(await getSettings()), ...patch }
  await Preferences.set({ key: KEY, value: JSON.stringify(next) })
  return next
}

export async function resetSettings(): Promise<AppSettings> {
  await Preferences.set({ key: KEY, value: JSON.stringify(DEFAULT_SETTINGS) })
  return { ...DEFAULT_SETTINGS }
}
