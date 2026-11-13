import { app } from 'electron'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { DEFAULT_SETTINGS, sanitizeSettings, type AppSettings } from '../shared/settings'
import SecureStore from './secureStore'

const KEY = 'app'

// Chromium switches are fixed before the encrypted store can be opened, so the
// few settings they need also live in a plain, secret-free file.
const bootFile = () => path.join(app.getPath('userData'), 'boot-settings.json')

export interface BootSettings {
  useVulkan: boolean
  ignoreGpuBlocklist: boolean
}

const BOOT_DEFAULTS: BootSettings = { useVulkan: false, ignoreGpuBlocklist: false }

export function readBootSettings(): BootSettings {
  try {
    const stored = JSON.parse(fs.readFileSync(bootFile(), 'utf8'))
    return { useVulkan: stored.useVulkan === true, ignoreGpuBlocklist: stored.ignoreGpuBlocklist === true }
  } catch {
    return { ...BOOT_DEFAULTS }
  }
}

export default class SettingsStore {
  private store = new SecureStore('settings')

  get(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...sanitizeSettings(this.store.get<unknown>(KEY, {})) }
  }

  update(input: unknown): AppSettings {
    const patch = sanitizeSettings(input)
    if (patch.xboxRegionIp !== undefined) {
      patch.xboxRegionIp = patch.xboxRegionIp.trim()
      // Goes straight into an HTTP header, so only a bare address may pass.
      if (patch.xboxRegionIp && !net.isIP(patch.xboxRegionIp)) throw new Error('Geçerli bir IP adresi gir')
    }
    const next = { ...this.get(), ...patch }
    this.save(next)
    return next
  }

  private save(next: AppSettings) {
    this.store.set(KEY, next)
    fs.writeFileSync(bootFile(), JSON.stringify({ useVulkan: next.useVulkan, ignoreGpuBlocklist: next.ignoreGpuBlocklist } satisfies BootSettings))
  }

  reset(): AppSettings {
    this.save(DEFAULT_SETTINGS)
    return { ...DEFAULT_SETTINGS }
  }
}
