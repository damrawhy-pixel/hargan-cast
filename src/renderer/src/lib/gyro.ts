// Gyro aiming for Xbox games with a DualSense: turning the controller moves the
// right stick, the way Steam Input's "gyro to joystick" does. The browser's
// Gamepad API has no motion data, so the controller's own HID reports are read
// (WebHID; the main process grants the DualSense, see index.ts) and the rate of
// turn is added to the right stick of the matching pad in navigator.getGamepads().

const SONY = 0x054c
const DUALSENSE = [0x0ce6, 0x0df2] // DualSense, DualSense Edge
const USB_REPORT = 0x01
const BT_REPORT = 0x31
const CALIBRATION_REPORT = 0x05
const GYRO_OFFSET = 15 // after the report id (and Bluetooth's extra byte)
const COUNTS_PER_DEG_S = 16.4
// Full stick at this many degrees a second, at sensitivity 1.
const FULL_STICK_DEG_S = 400
// Games ignore small stick movements; gyro output starts just past that.
const ANTI_DEAD_ZONE = 0.12
// Below this the controller is taken to be still, and its slow drift is learned.
const STILL_DEG_S = 3
const BIAS_RATE = 0.002
// L2 / LT, standard index 6: the "aiming" button.
const AIM_BUTTON = 6

export interface GyroOptions {
  /** 'aim' turns the gyro on only while the left trigger is held. */
  mode: 'always' | 'aim'
  sensitivity: number
  invertX: boolean
  invertY: boolean
}

interface HidDevice extends EventTarget {
  vendorId: number
  productId: number
  opened: boolean
  open(): Promise<void>
  close(): Promise<void>
  receiveFeatureReport(id: number): Promise<DataView>
}
type InputReport = Event & { reportId: number; data: DataView }

const isDualSensePad = (pad: Gamepad) => /054c/i.test(pad.id) && /0ce6|0df2/i.test(pad.id)

/** A stick value with the game's dead zone stepped over, so slow turns still register. */
export function gyroToStick(degPerSecond: number, sensitivity: number) {
  const raw = (degPerSecond * sensitivity) / FULL_STICK_DEG_S
  if (raw === 0) return 0
  const magnitude = Math.min(1, ANTI_DEAD_ZONE + Math.abs(raw) * (1 - ANTI_DEAD_ZONE))
  return Math.sign(raw) * magnitude
}

/** Pitch and yaw in degrees a second from an input report, or undefined for other reports. */
export function readGyro(reportId: number, data: DataView): { pitch: number; yaw: number } | undefined {
  const base = reportId === USB_REPORT ? 0 : reportId === BT_REPORT ? 1 : -1
  if (base < 0 || data.byteLength < base + GYRO_OFFSET + 4) return undefined
  return {
    pitch: data.getInt16(base + GYRO_OFFSET, true) / COUNTS_PER_DEG_S,
    yaw: data.getInt16(base + GYRO_OFFSET + 2, true) / COUNTS_PER_DEG_S,
  }
}

/**
 * Starts gyro aiming; resolves to a stop function, or undefined when there is no
 * DualSense or no WebHID.
 */
export async function startGyroAim(options: GyroOptions): Promise<(() => void) | undefined> {
  const hid = (navigator as Navigator & { hid?: { getDevices(): Promise<HidDevice[]> } }).hid
  if (!hid || typeof navigator.getGamepads !== 'function') return undefined
  const device = (await hid.getDevices().catch(() => [] as HidDevice[])).find((d) => d.vendorId === SONY && DUALSENSE.includes(d.productId))
  if (!device) return undefined
  try {
    if (!device.opened) await device.open()
  } catch {
    return undefined
  }
  // Reading the calibration report switches a Bluetooth DualSense to its full reports, which carry motion.
  void device.receiveFeatureReport(CALIBRATION_REPORT).catch(() => {})

  const bias = { pitch: 0, yaw: 0 }
  const rate = { pitch: 0, yaw: 0 }
  const onReport = (event: Event) => {
    const { reportId, data } = event as InputReport
    const gyro = readGyro(reportId, data)
    if (!gyro) return
    for (const axis of ['pitch', 'yaw'] as const) {
      const value = gyro[axis] - bias[axis]
      if (Math.abs(value) < STILL_DEG_S) bias[axis] += value * BIAS_RATE
      rate[axis] = Math.abs(value) < STILL_DEG_S / 3 ? 0 : value
    }
  }
  device.addEventListener('inputreport', onReport)

  const below = navigator.getGamepads.bind(navigator)
  const own = Object.getOwnPropertyDescriptor(navigator, 'getGamepads')
  let on = true
  const clamp = (v: number) => Math.max(-1, Math.min(1, v))
  const mine = () =>
    Array.from(below() ?? []).map((pad) => {
      if (!on || !pad || !isDualSensePad(pad) || pad.axes.length < 4) return pad
      if (options.mode === 'aim' && (pad.buttons[AIM_BUTTON]?.value ?? 0) < 0.3) return pad
      const axes = pad.axes.slice()
      // Turning left (positive yaw) looks left; tilting the top away (positive pitch) looks up.
      axes[2] = clamp(axes[2] + gyroToStick(-rate.yaw, options.sensitivity) * (options.invertX ? -1 : 1))
      axes[3] = clamp(axes[3] + gyroToStick(-rate.pitch, options.sensitivity) * (options.invertY ? -1 : 1))
      return {
        id: pad.id,
        index: pad.index,
        connected: pad.connected,
        mapping: pad.mapping,
        timestamp: pad.timestamp,
        axes,
        buttons: pad.buttons,
        vibrationActuator: pad.vibrationActuator,
        hapticActuators: (pad as Gamepad & { hapticActuators?: unknown }).hapticActuators,
      } as unknown as Gamepad
    })
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: mine })

  return () => {
    on = false
    device.removeEventListener('inputreport', onReport)
    void device.close().catch(() => {})
    if (Object.getOwnPropertyDescriptor(navigator, 'getGamepads')?.value !== mine) return
    if (own) Object.defineProperty(navigator, 'getGamepads', own)
    else delete (navigator as { getGamepads?: unknown }).getGamepads
  }
}
