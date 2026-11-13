// Copies installed with the setup program keep themselves current from the
// project's GitHub releases: a new version downloads in the background and is
// installed when the app closes. A copy run straight from a build folder is left alone.
//
// Two channels: stable follows normal releases; beta also takes GitHub
// pre-releases (tags such as v0.4.0-beta.1) and every stable release after them.
// The GitHub provider finds each release's feed from its tag, so no channel name is
// set here. A release may reach only part of the installs first (stagingPercentage
// in its feed, see .github/workflows/rollout.yml).
import { app, Notification } from 'electron'
import { autoUpdater } from 'electron-updater'
import { t } from '../shared/i18n'
import fs from 'node:fs'
import path from 'node:path'

const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

// The setup program leaves its uninstaller next to the app; a folder build has none.
function installedBySetup() {
  const folder = path.dirname(process.execPath)
  return fs.readdirSync(folder).some((name) => /^Uninstall .*\.exe$/i.test(name))
}

/** Picks the update channel; safe to call before or after startUpdates. */
export function applyUpdateChannel(beta: boolean) {
  autoUpdater.allowPrerelease = beta
  // Leaving beta keeps the installed pre-release until a newer stable one exists.
  autoUpdater.allowDowngrade = false
}

export function startUpdates(beta: boolean) {
  if (!app.isPackaged || !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml')) || !installedBySetup()) return

  autoUpdater.logger = null
  applyUpdateChannel(beta)
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => {
    new Notification({
      title: t('Hargan Cast güncellemesi hazır'),
      body: t('{version} sürümü, uygulamayı kapattığında kurulacak.', { version: info.version }),
    }).show()
  })
  // No connection or no release yet: try again at the next check.
  autoUpdater.on('error', () => {})

  const check = () => void autoUpdater.checkForUpdates().catch(() => {})
  setTimeout(check, FIRST_CHECK_MS)
  setInterval(check, CHECK_EVERY_MS)
}
