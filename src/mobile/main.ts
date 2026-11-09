// Entry point of the phone and tablet apps: Node globals first, then window.hc,
// then the same interface the desktop runs.
import './shims/globals'

const { installBridge } = await import('./bridge')
await installBridge()
await import('../renderer/src/main')
