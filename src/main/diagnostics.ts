// A single text file the user can attach to a bug report: versions, system,
// graphics status, settings and the recent log. Secrets are left out.
import { app, dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AppSettings } from '../shared/settings'
import { environmentLabel } from './environment'
import { logFile, redact } from './log'
import { t } from '../shared/i18n'

const PRIVATE_SETTINGS: (keyof AppSettings)[] = ['xboxTurnUsername', 'xboxTurnCredential']

// Names, sizes and times only: a dump holds process memory, so it is never copied
// into the report. The user can attach one from the folder if asked.
function listDumps() {
  const root = app.getPath('crashDumps')
  const found: string[] = []
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.name.endsWith('.dmp')) {
        const stat = fs.statSync(file)
        found.push(`${stat.mtime.toISOString()}  ${Math.round(stat.size / 1024)} KB  ${path.relative(root, file)}`)
      }
    }
  }
  walk(root)
  return [root, ...(found.length ? found.sort().reverse().slice(0, 20) : ['-'])].join('\n')
}

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
    `Dil ${app.getLocale()}, kurulu: ${app.isPackaged}, ortam: ${environmentLabel()}`,
    `\n== Grafik ==\n${JSON.stringify(gpu, null, 1)}`,
    `\n== Ayarlar ==\n${JSON.stringify(shown, null, 1)}`,
    `\n== Çökme dökümleri ==\n${listDumps()}`,
    `\n== Önceki log ==\n${readLog(`${logFile()}.1`)}`,
    `\n== Log ==\n${readLog(logFile())}`,
  ]
  fs.writeFileSync(filePath, redact(sections.join('\n')))
  return filePath
}
