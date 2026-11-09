// Turns the Gamepad API and keyboard into Chiaki controller reports.
import { VIRTUAL_PAD_ID, virtualPadState } from '../lib/virtualPad'

const BUTTON = {
  CROSS: 1 << 0,
  MOON: 1 << 1,
  BOX: 1 << 2,
  PYRAMID: 1 << 3,
  LEFT: 1 << 4,
  RIGHT: 1 << 5,
  UP: 1 << 6,
  DOWN: 1 << 7,
  L1: 1 << 8,
  R1: 1 << 9,
  L3: 1 << 10,
  R3: 1 << 11,
  OPTIONS: 1 << 12,
  SHARE: 1 << 13,
  TOUCHPAD: 1 << 14,
  PS: 1 << 15,
}

// Index in the W3C standard gamepad layout -> controller button.
const STANDARD_BUTTONS: [number, number][] = [
  [0, BUTTON.CROSS], [1, BUTTON.MOON], [2, BUTTON.BOX], [3, BUTTON.PYRAMID],
  [4, BUTTON.L1], [5, BUTTON.R1], [8, BUTTON.SHARE], [9, BUTTON.OPTIONS],
  [10, BUTTON.L3], [11, BUTTON.R3], [12, BUTTON.UP], [13, BUTTON.DOWN],
  [14, BUTTON.LEFT], [15, BUTTON.RIGHT], [16, BUTTON.PS], [17, BUTTON.TOUCHPAD],
]

const KEYS: Record<string, number> = {
  KeyZ: BUTTON.CROSS, KeyX: BUTTON.MOON, KeyA: BUTTON.BOX, KeyS: BUTTON.PYRAMID,
  ArrowUp: BUTTON.UP, ArrowDown: BUTTON.DOWN, ArrowLeft: BUTTON.LEFT, ArrowRight: BUTTON.RIGHT,
  KeyQ: BUTTON.L1, KeyE: BUTTON.R1, Enter: BUTTON.OPTIONS, Backspace: BUTTON.SHARE,
  KeyT: BUTTON.TOUCHPAD, Home: BUTTON.PS,
}

const POLL_MS = 4
const REPORT_SIZE = 15

const trigger = (v: number) => Math.round(v * 255)

const SONY_VENDOR = /054c|dualsense/i

// While the sidecar owns a DualSense directly, the browser's view of it would
// only echo the same input with extra delay.
function activePad(skipDualSense: () => boolean) {
  return navigator.getGamepads().find((p) => p?.connected && !(skipDualSense() && SONY_VENDOR.test(p.id)))
}

export interface InputOptions {
  deadZone: number
  keyboard: boolean
  buttonsByPosition: boolean
}

const FACE_BY_POSITION: Record<number, number> = { [BUTTON.CROSS]: BUTTON.MOON, [BUTTON.MOON]: BUTTON.CROSS, [BUTTON.BOX]: BUTTON.PYRAMID, [BUTTON.PYRAMID]: BUTTON.BOX }

export function startInput(send: (report: ArrayBuffer) => void, nativeDualSense: () => boolean, { deadZone, keyboard, buttonsByPosition }: InputOptions) {
  const axis = (v: number) => (Math.abs(v) < deadZone ? 0 : Math.round(v * 32767))
  const held = new Set<string>()
  const previous = new Uint8Array(REPORT_SIZE)

  const onKey = (e: KeyboardEvent) => {
    if (!keyboard || (!(e.code in KEYS) && e.code !== 'KeyC' && e.code !== 'KeyV')) return
    e.preventDefault()
    if (e.type === 'keydown') held.add(e.code)
    else held.delete(e.code)
  }
  const clearKeys = () => held.clear()
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKey)
  window.addEventListener('blur', clearKeys)

  const timer = setInterval(() => {
    let buttons = 0
    let l2 = 0
    let r2 = 0
    let lx = 0
    let ly = 0
    let rx = 0
    let ry = 0

    for (const code of held) buttons |= KEYS[code] ?? 0
    if (held.has('KeyC')) l2 = 255
    if (held.has('KeyV')) r2 = 255

    const pad = activePad(nativeDualSense)
    if (pad) {
      // The on-screen controls are drawn in the controller's own layout; never swap them.
      const swap = buttonsByPosition && pad.id !== VIRTUAL_PAD_ID
      for (const [index, bit] of STANDARD_BUTTONS) if (pad.buttons[index]?.pressed) buttons |= (swap && FACE_BY_POSITION[bit]) || bit
      l2 = Math.max(l2, trigger(pad.buttons[6]?.value ?? 0))
      r2 = Math.max(r2, trigger(pad.buttons[7]?.value ?? 0))
      lx = axis(pad.axes[0] ?? 0)
      ly = axis(pad.axes[1] ?? 0)
      rx = axis(pad.axes[2] ?? 0)
      ry = axis(pad.axes[3] ?? 0)
    }

    // On-screen controls left visible next to a real controller add to it.
    const touch = pad?.id === VIRTUAL_PAD_ID ? undefined : virtualPadState()
    if (touch) {
      const stronger = (a: number, b: number) => (Math.abs(b) > Math.abs(a) ? b : a)
      for (const [index, bit] of STANDARD_BUTTONS) if (touch.values[index] > 0.5) buttons |= bit
      l2 = Math.max(l2, trigger(touch.values[6]))
      r2 = Math.max(r2, trigger(touch.values[7]))
      lx = stronger(lx, axis(touch.axes[0]))
      ly = stronger(ly, axis(touch.axes[1]))
      rx = stronger(rx, axis(touch.axes[2]))
      ry = stronger(ry, axis(touch.axes[3]))
    }

    const report = new ArrayBuffer(REPORT_SIZE)
    const view = new DataView(report)
    view.setUint8(0, 1)
    view.setUint32(1, buttons, true)
    view.setUint8(5, l2)
    view.setUint8(6, r2)
    view.setInt16(7, lx, true)
    view.setInt16(9, ly, true)
    view.setInt16(11, rx, true)
    view.setInt16(13, ry, true)

    const bytes = new Uint8Array(report)
    if (bytes.every((b, i) => b === previous[i])) return
    previous.set(bytes)
    send(report)
  }, POLL_MS)

  return () => {
    clearInterval(timer)
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('keyup', onKey)
    window.removeEventListener('blur', clearKeys)
  }
}

export function rumble(left: number, right: number, nativeDualSense: () => boolean) {
  activePad(nativeDualSense)?.vibrationActuator?.playEffect('dual-rumble', {
    duration: 250,
    strongMagnitude: left / 255,
    weakMagnitude: right / 255,
  })
}
