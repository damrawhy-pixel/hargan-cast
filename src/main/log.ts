import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const MAX_LOG_BYTES = 512 * 1024
const MAX_LINE = 4000

// Tokens that must never reach a log, even when a caller slips: bearer and XBL
// authorization values, Sony's NPSSO, and anything after a query string's '?'.
const SECRETS: [RegExp, string][] = [
  [/(Bearer|XBL3\.0)\s+\S+/gi, '$1 [gizli]'],
  [/(npsso["'=:\s]+)[A-Za-z0-9]{20,}/gi, '$1[gizli]'],
  [/(https?:\/\/[^\s?#"']+)\?[^\s"']*/g, '$1?[gizli]'],
  [/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{16,}\b/g, '[gizli-jwt]'],
]

export function redact(text: string) {
  return SECRETS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text)
}

export const logFile = () => path.join(app.getPath('userData'), 'logs', 'hargan.log')

// Diagnostics for packaged builds, where the console is silenced. The current
// file rolls over into hargan.log.1 so the moments before a problem survive it.
export function log(message: string) {
  try {
    const file = logFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, `${file}.1`)
    fs.appendFileSync(file, `${new Date().toISOString()} ${redact(message).slice(0, MAX_LINE)}\n`)
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
