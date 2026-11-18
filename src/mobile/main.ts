// Entry point of the phone and tablet apps: Node globals first, then window.hc,
// then the same interface the desktop runs.
import './shims/globals'
import { resolveLanguage, setLanguage, t } from '../shared/i18n'

// Settings are not read yet; the start-up error below follows the phone's language.
setLanguage(resolveLanguage('', navigator.language))

// Release builds drop console calls (vite.mobile.config.ts). These few lines are
// meant for the iOS simulator test and the device log, so they go around that.
const say = (level: 'info' | 'warn' | 'error', text: string) => globalThis.console[level](text)

// If start-up itself fails there is no interface yet to show it, and the screen
// would stay black: write the error out plainly so it can be reported.
function showStartupError(error: unknown) {
  const e = error instanceof Error ? error : new Error(String(error))
  say('error', `hargan: startup failed: ${e.name}: ${e.message} ${e.stack?.split('\n').slice(0, 4).join(' | ') ?? ''}`)
  const panel = document.createElement('div')
  panel.setAttribute('role', 'alert')
  panel.style.cssText =
    'position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;justify-content:center;gap:14px;padding:calc(24px + env(safe-area-inset-top)) 24px 24px;background:#05060b;color:#f2f4f8;font:15px system-ui,sans-serif;overflow:auto;-webkit-user-select:text;user-select:text'
  const title = document.createElement('h1')
  title.textContent = t('Uygulama açılamadı')
  title.style.cssText = 'margin:0;font-size:24px'
  const text = document.createElement('p')
  text.textContent = t('Başlarken bir hata oluştu. Aşağıdaki yazıyı bize iletirsen sorunu bulmamız kolaylaşır.')
  text.style.cssText = 'margin:0;color:#b4bccb;line-height:1.5'
  const detail = document.createElement('pre')
  detail.textContent = [`${e.name}: ${e.message}`, e.stack?.split('\n').slice(0, 6).join('\n')].filter(Boolean).join('\n\n')
  detail.style.cssText = 'margin:0;padding:14px;border-radius:12px;background:rgba(255,255,255,.06);color:#ffb4a8;font-size:12px;white-space:pre-wrap;word-break:break-word'
  const retry = document.createElement('button')
  retry.textContent = t('Yeniden dene')
  retry.style.cssText = 'align-self:flex-start;padding:10px 18px;border:0;border-radius:999px;background:#fff;color:#05060b;font:600 15px system-ui,sans-serif'
  retry.onclick = () => location.reload()
  panel.append(title, text, detail, retry)
  document.body.append(panel)
}

// The iOS simulator test (.github/workflows/mobile.yml) reads the app's console:
// a line for every uncaught error, and one once the interface is on screen.
addEventListener('error', (e) => say('error', `hargan: uncaught ${e.message}`))
function reportReady(tries = 0) {
  if (document.querySelector('.topbar')) return say('info', 'hargan: interface ready')
  // Still nothing after a minute: say what the page shows instead.
  if (tries >= 240) return say('warn', `hargan: no interface; the page shows: ${document.body.innerText.replace(/\s+/g, ' ').slice(0, 400)}`)
  setTimeout(() => reportReady(tries + 1), 250)
}

try {
  const { installBridge } = await import('./bridge')
  await installBridge()
  await import('../renderer/src/main')
  reportReady()
} catch (error) {
  showStartupError(error)
}
