// A controller made of the on-screen touch controls. While they are on screen it
// shows up in navigator.getGamepads() like a real one, in the W3C standard layout,
// so the PlayStation and Xbox input code read it without knowing the difference.
// Nothing is patched until the touch controls first appear, which is never on the desktop.

/** Button indexes of the standard gamepad layout. */
export const PAD = {
  SOUTH: 0,
  EAST: 1,
  WEST: 2,
  NORTH: 3,
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  VIEW: 8,
  MENU: 9,
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
  HOME: 16,
  TOUCHPAD: 17,
} as const

export const VIRTUAL_PAD_ID = 'Hargan Cast touch controls (STANDARD GAMEPAD)'

const BUTTON_COUNT = 18
const values = new Float32Array(BUTTON_COUNT)
const axes = [0, 0, 0, 0]
let active = false
let timestamp = 0
let nativeGetGamepads: (() => (Gamepad | null)[]) | undefined

const touch = () => {
  timestamp = performance.now()
}

function snapshot(index: number): Gamepad {
  return {
    id: VIRTUAL_PAD_ID,
    index,
    connected: true,
    mapping: 'standard',
    timestamp,
    axes: axes.slice(),
    buttons: Array.from(values, (value) => ({ pressed: value > 0.5, touched: value > 0, value })),
    vibrationActuator: null,
    hapticActuators: [],
  } as unknown as Gamepad
}

function install() {
  if (nativeGetGamepads) return
  // A web view without the Gamepad API still gets the touch controller.
  const original: () => (Gamepad | null)[] = typeof navigator.getGamepads === 'function' ? navigator.getGamepads.bind(navigator) : () => []
  nativeGetGamepads = () => Array.from(original() ?? [])
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: () => {
      const list = nativeGetGamepads!()
      if (!active) return list
      // First free slot, so a lone touch pad is player one.
      let slot = list.findIndex((p) => !p)
      if (slot < 0) slot = list.length
      list[slot] = snapshot(slot)
      return list
    },
  })
}

/** Controllers that are really there, leaving the touch one out. */
export function physicalPads(): Gamepad[] {
  const list = nativeGetGamepads ? nativeGetGamepads() : Array.from(navigator.getGamepads?.() ?? [])
  return list.filter((p): p is Gamepad => Boolean(p?.connected) && p!.id !== VIRTUAL_PAD_ID)
}

export function setVirtualPad(on: boolean) {
  install()
  active = on
  values.fill(0)
  axes.fill(0)
  touch()
}

export function setButton(index: number, down: boolean) {
  const value = down ? 1 : 0
  if (values[index] === value) return
  values[index] = value
  touch()
}

/** x and y in -1..1, y pointing down as in the standard layout. */
export function setStick(side: 'left' | 'right', x: number, y: number) {
  const at = side === 'left' ? 0 : 2
  axes[at] = x
  axes[at + 1] = y
  touch()
}

/** The touch controls' state while they are on screen, for code that reads one controller only. */
export function virtualPadState(): { values: Float32Array; axes: number[] } | undefined {
  return active ? { values, axes } : undefined
}
