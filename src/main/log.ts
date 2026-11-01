import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const MAX_LOG_BYTES = 512 * 1024

// Diagnostics for packaged builds, where the console is silenced. Callers must
// never pass tokens, cookies or query strings.
export function log(message: string) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'hargan.log')
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) fs.rmSync(file)
    fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Logging must never break the app.
  }
}

export function safeUrl(url: string) {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return 'invalid-url'
  }
}
