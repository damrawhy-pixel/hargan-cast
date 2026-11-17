// Controller layout changes: which button does what, swapped sticks, inverted
// look. While a stream runs, navigator.getGamepads() hands out remapped copies of
// the real controllers, so the PlayStation input code and the Xbox player both see
// the user's layout without knowing about it. A DualSense the PlayStation core
// reads itself gets the same map there (see remap.c).

import { PAD, VIRTUAL_PAD_ID } from './virtualPad'

export const BUTTON_COUNT = 18
const IDENTITY = Array.from({ length: BUTTON_COUNT }, (_, i) => i)

export interface PadLayout {
  /** For each standard button, the physical button that presses it. */
  map: number[]
  swapSticks: boolean
  invertY: boolean
}

/** '' is the default layout; otherwise 18 comma-separated button indexes. */
export function parseButtonMap(text: string): number[] {
  if (!text) return IDENTITY.slice()
  const map = text.split(',').map(Number)
  return map.length === BUTTON_COUNT && map.every((n) => Number.isInteger(n) && n >= 0 && n < BUTTON_COUNT) ? map : IDENTITY.slice()
}

export function formatButtonMap(map: number[]): string {
  return map.every((n, i) => n === i) ? '' : map.join(',')
}

export const isDefaultLayout = (l: PadLayout) => !l.swapSticks && !l.invertY && l.map.every((n, i) => n === i)

const RELEASED = { pressed: false, touched: false, value: 0 } as GamepadButton

function remapped(pad: Gamepad, layout: PadLayout): Gamepad {
  const axes = pad.axes.slice()
  if (layout.swapSticks && axes.length >= 4) axes.splice(0, 4, axes[2], axes[3], axes[0], axes[1])
  if (layout.invertY && axes.length >= 4) axes[3] = -axes[3]
  const buttons = pad.buttons.slice()
  for (let out = 0; out < BUTTON_COUNT; out++) buttons[out] = pad.buttons[layout.map[out]] ?? RELEASED
  // Gamepad's fields are getters on its prototype, so a copy has to name them;
  // the actuators stay the real ones so rumble still reaches the controller.
  return {
    id: pad.id,
    index: pad.index,
    connected: pad.connected,
    mapping: pad.mapping,
    timestamp: pad.timestamp,
    axes,
    buttons,
    vibrationActuator: pad.vibrationActuator,
    hapticActuators: (pad as Gamepad & { hapticActuators?: unknown }).hapticActuators,
  } as unknown as Gamepad
}

/**
 * Applies a layout to every standard-mapped controller until the returned
 * function is called. The touch controller keeps its own layout.
 */
export function installLayout(layout: PadLayout): () => void {
  if (isDefaultLayout(layout) || typeof navigator.getGamepads !== 'function') return () => {}
  const own = Object.getOwnPropertyDescriptor(navigator, 'getGamepads')
  const below = navigator.getGamepads.bind(navigator)
  let on = true
  const mine = () =>
    Array.from(below() ?? []).map((pad) => (on && pad && pad.mapping === 'standard' && pad.id !== VIRTUAL_PAD_ID ? remapped(pad, layout) : pad))
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: mine })
  return () => {
    on = false
    // Something patched on top of this layer since (the touch controller does);
    // leave it, now passing everything through untouched.
    if (Object.getOwnPropertyDescriptor(navigator, 'getGamepads')?.value !== mine) return
    if (own) Object.defineProperty(navigator, 'getGamepads', own)
    else delete (navigator as { getGamepads?: unknown }).getGamepads
  }
}

/** Buttons by standard index, named for both families of controller. */
export const BUTTON_NAMES: Record<number, [string, string]> = {
  [PAD.SOUTH]: ['✕', 'A'],
  [PAD.EAST]: ['○', 'B'],
  [PAD.WEST]: ['□', 'X'],
  [PAD.NORTH]: ['△', 'Y'],
  [PAD.L1]: ['L1', 'LB'],
  [PAD.R1]: ['R1', 'RB'],
  [PAD.L2]: ['L2', 'LT'],
  [PAD.R2]: ['R2', 'RT'],
  [PAD.VIEW]: ['Create', 'View'],
  [PAD.MENU]: ['Options', 'Menu'],
  [PAD.L3]: ['L3', 'LS'],
  [PAD.R3]: ['R3', 'RS'],
  [PAD.UP]: ['↑', '↑'],
  [PAD.DOWN]: ['↓', '↓'],
  [PAD.LEFT]: ['←', '←'],
  [PAD.RIGHT]: ['→', '→'],
  [PAD.HOME]: ['PS', 'Xbox'],
  [PAD.TOUCHPAD]: ['Touchpad', 'Share'],
}

export const buttonName = (index: number) => BUTTON_NAMES[index].join(' / ')
