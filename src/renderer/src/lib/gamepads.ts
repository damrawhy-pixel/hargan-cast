// Every connected controller, or none where the browser has no Gamepad API at all
// (some web views), so reading pads can never throw.
export function connectedPads(): Gamepad[] {
  if (typeof navigator.getGamepads !== 'function') return []
  return Array.from(navigator.getGamepads() ?? []).filter((p): p is Gamepad => Boolean(p?.connected))
}
