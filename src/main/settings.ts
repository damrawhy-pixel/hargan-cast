import { app } from 'electron'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/settings'
import SecureStore from './secureStore'

const KEY = 'app'

// Chromium switches are fixed before the encrypted store can be opened, so the
// few settings they need also live in a plain, secret-free file.
const bootFile = () => path.join(app.getPath('userData'), 'boot-settings.json')

export function readBootSettings(): { useVulkan: boolean } {
  try {
    return JSON.parse(fs.readFileSync(bootFile(), 'utf8'))
  } catch {
    return { useVulkan: false }
  }
}

export default class SettingsStore {
  private store = new SecureStore('settings')

  get(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...this.store.get<Partial<AppSettings>>(KEY, {}) }
  }

  update(patch: Partial<AppSettings>): AppSettings {
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
    fs.writeFileSync(bootFile(), JSON.stringify({ useVulkan: next.useVulkan }))
  }

  reset(): AppSettings {
    this.save(DEFAULT_SETTINGS)
    return { ...DEFAULT_SETTINGS }
  }
}
