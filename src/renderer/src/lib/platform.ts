// The phone and tablet apps mark the page before the interface loads (src/mobile/bridge.ts).
export const MOBILE = typeof document !== 'undefined' && document.documentElement.dataset.platform === 'mobile'

/** The desktop app on Windows, where the features that lean on Windows itself live. */
export const WINDOWS = !MOBILE && typeof window !== 'undefined' && Boolean(window.hc?.platform.windows)
