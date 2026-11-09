import { Component, type ErrorInfo, type ReactNode } from 'react'

// When part of the interface fails, React would otherwise leave an empty black
// window. This shows what went wrong instead, so it can be reported, and offers
// a restart.
export class CrashScreen extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Hargan Cast interface error', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return <ErrorPanel message={`${error.name}: ${error.message}`} detail={error.stack} />
  }
}

export function ErrorPanel({ message, detail }: { message: string; detail?: string }) {
  return (
    <div className="crash" role="alert">
      <h1>Bir şeyler ters gitti</h1>
      <p>Uygulama beklenmedik bir hatayla durdu. Aşağıdaki yazıyı bize iletirsen sorunu bulmamız kolaylaşır.</p>
      <pre>{[message, detail?.split('\n').slice(0, 6).join('\n')].filter(Boolean).join('\n\n')}</pre>
      <button className="primary" onClick={() => location.reload()}>Yeniden başlat</button>
    </div>
  )
}
