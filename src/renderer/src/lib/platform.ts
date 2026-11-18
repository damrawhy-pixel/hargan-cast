// The phone and tablet apps mark the page before the interface loads (src/mobile/bridge.ts).
export const MOBILE = typeof document !== 'undefined' && document.documentElement.dataset.platform === 'mobile'
