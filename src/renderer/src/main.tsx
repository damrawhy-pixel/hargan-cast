import { useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { getLanguage, onLanguageChange } from '../../shared/i18n'
import { App } from './App'
import { CrashScreen } from './components/CrashScreen'
import './styles.css'

// Failures outside React's tree (timers, promises, workers' hosts) end up in the log too.
const report = (text: string) => window.hc?.platform.reportError?.(text)
window.addEventListener('error', (e) => report(`error: ${e.message} (${e.filename}:${e.lineno})
${e.error?.stack ?? ''}`))
window.addEventListener('unhandledrejection', (e) => report(`unhandled rejection: ${e.reason?.stack ?? e.reason}`))

// A language change rebuilds the interface, so text cached in components follows.
// It is only offered in Settings, never during a stream.
function Root() {
  const language = useSyncExternalStore(onLanguageChange, getLanguage)
  return (
    <CrashScreen key={language}>
      <App />
    </CrashScreen>
  )
}

createRoot(document.getElementById('root')!).render(<Root />)
