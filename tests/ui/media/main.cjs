// A bare Electron window for the media test: same Chromium and decoders as the
// app, but it loads the e2e harness (tests/e2e/server.mjs) instead of the app.
const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1280, height: 800, webPreferences: { sandbox: true, contextIsolation: true } })
  void win.loadURL('about:blank')
})
app.on('window-all-closed', () => app.quit())
