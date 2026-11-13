// A single text file the user can attach to a bug report: versions, system,
// graphics status, settings and the recent log. Secrets are left out.
import { app, dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AppSettings } from '../shared/settings'
import { logFile, redact } from './log'
import { t } from '../shared/i18n'

const PRIVATE_SETTINGS: (keyof AppSettings)[] = ['xboxTurnUsername', 'xboxTurnCredential']

function readLog(file: string) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

export async function exportDiagnostics(win: BrowserWindow | undefined, settings: AppSettings) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const options = {
    title: t('Tanılama dosyasını kaydet'),
    defaultPath: path.join(app.getPath('desktop'), `HarganCast-tanilama-${stamp}.txt`),
    filters: [{ name: t('Metin'), extensions: ['txt'] }],
  }
  const { canceled, filePath } = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return undefined

  const shown: Record<string, unknown> = { ...settings }
  for (const key of PRIVATE_SETTINGS) if (shown[key]) shown[key] = '[gizli]'

  const gpu = app.getGPUFeatureStatus()
  const sections = [
    `Hargan Cast ${app.getVersion()} — ${new Date().toISOString()}`,
    `Electron ${process.versions.electron}, Chromium ${process.versions.chrome}, Node ${process.versions.node}`,
    `Windows ${os.release()} ${os.arch()}, ${os.cpus()[0]?.model ?? '?'} ×${os.cpus().length}, RAM ${Math.round(os.totalmem() / 2 ** 30)} GB`,
    `Dil ${app.getLocale()}, kurulu: ${app.isPackaged}`,
    `\n== Grafik ==\n${JSON.stringify(gpu, null, 1)}`,
    `\n== Ayarlar ==\n${JSON.stringify(shown, null, 1)}`,
    `\n== Önceki log ==\n${readLog(`${logFile()}.1`)}`,
    `\n== Log ==\n${readLog(logFile())}`,
  ]
  fs.writeFileSync(filePath, redact(sections.join('\n')))
  return filePath
}
