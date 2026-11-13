import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CrashScreen } from './components/CrashScreen'
import './styles.css'

// Failures outside React's tree (timers, promises, workers' hosts) end up in the log too.
const report = (text: string) => window.hc?.platform.reportError?.(text)
window.addEventListener('error', (e) => report(`error: ${e.message} (${e.filename}:${e.lineno})
${e.error?.stack ?? ''}`))
window.addEventListener('unhandledrejection', (e) => report(`unhandled rejection: ${e.reason?.stack ?? e.reason}`))

createRoot(document.getElementById('root')!).render(
  <CrashScreen>
    <App />
  </CrashScreen>,
)
