// On laptops with two graphics cards Windows decides which one an app gets, from
// its own per-app list (Settings > System > Display > Graphics). Without an entry
// a game stream can land on the weaker chip. The app adds itself as "High
// performance" when it has no entry yet; a choice the user made there stays.
import { execFile } from 'node:child_process'
import { log } from './log'

const KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
const HIGH_PERFORMANCE = 'GpuPreference=2;'

const reg = (args: string[]) =>
  new Promise<{ ok: boolean; out: string }>((resolve) => {
    execFile('reg', args, { windowsHide: true, timeout: 5000 }, (error, stdout) => resolve({ ok: !error, out: String(stdout) }))
  })

/** Takes effect from the next start: Chromium picks its adapter as it launches. */
export async function preferHighPerformanceGpu(exe: string) {
  if (process.platform !== 'win32') return
  const existing = await reg(['query', KEY, '/v', exe])
  if (existing.ok) return
  const added = await reg(['add', KEY, '/v', exe, '/t', 'REG_SZ', '/d', HIGH_PERFORMANCE, '/f'])
  log(added.ok ? 'gpu preference: high performance set for the app' : 'gpu preference: could not be set')
}
