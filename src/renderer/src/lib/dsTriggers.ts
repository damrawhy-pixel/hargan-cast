// Xbox games' trigger rumble on a DualSense. The Xbox player sends trigger
// rumble only to controllers whose vibration lists 'trigger-rumble', which the
// browser gives Xbox controllers alone. For a DualSense this layer lists it,
// plays the body rumble through the browser as before, and hands the trigger
// strengths to the PlayStation core, which turns them into the DualSense's own
// trigger vibration (main.c, dsTriggers).

const isDualSensePad = (pad: Gamepad) => /054c/i.test(pad.id) && /0ce6|0df2/i.test(pad.id)

interface TriggerRumble {
  duration?: number
  strongMagnitude?: number
  weakMagnitude?: number
  leftTrigger?: number
  rightTrigger?: number
}

export function installTriggerBridge(send: (left: number, right: number) => void): () => void {
  if (typeof navigator.getGamepads !== 'function') return () => {}
  const actuators = new WeakMap<object, GamepadHapticActuator>()
  let stopAt: ReturnType<typeof setTimeout> | undefined
  let active = false
  const play = (left: number, right: number, ms: number) => {
    clearTimeout(stopAt)
    active = left > 0 || right > 0
    send(Math.round(left * 255), Math.round(right * 255))
    if (active) stopAt = setTimeout(() => play(0, 0, 0), Math.max(16, ms))
  }

  const wrap = (real: GamepadHapticActuator): GamepadHapticActuator => {
    const known = actuators.get(real)
    if (known) return known
    const proxy = {
      type: 'dual-rumble',
      effects: ['dual-rumble', 'trigger-rumble'],
      playEffect(type: string, params: TriggerRumble = {}) {
        if (type === 'trigger-rumble') {
          play(params.leftTrigger ?? 0, params.rightTrigger ?? 0, params.duration ?? 100)
          // The body motors still go through the browser.
          return real.playEffect('dual-rumble', { duration: params.duration ?? 100, strongMagnitude: params.strongMagnitude ?? 0, weakMagnitude: params.weakMagnitude ?? 0 })
        }
        return real.playEffect(type as GamepadHapticEffectType, params)
      },
      reset() {
        play(0, 0, 0)
        return real.reset()
      },
    } as unknown as GamepadHapticActuator
    actuators.set(real, proxy)
    return proxy
  }

  const below = navigator.getGamepads.bind(navigator)
  const own = Object.getOwnPropertyDescriptor(navigator, 'getGamepads')
  let on = true
  const mine = () =>
    Array.from(below() ?? []).map((pad) => {
      if (!on || !pad || !isDualSensePad(pad) || !pad.vibrationActuator) return pad
      return {
        id: pad.id,
        index: pad.index,
        connected: pad.connected,
        mapping: pad.mapping,
        timestamp: pad.timestamp,
        axes: pad.axes,
        buttons: pad.buttons,
        vibrationActuator: wrap(pad.vibrationActuator),
        hapticActuators: (pad as Gamepad & { hapticActuators?: unknown }).hapticActuators,
      } as unknown as Gamepad
    })
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: mine })

  return () => {
    on = false
    clearTimeout(stopAt)
    send(-1, -1)
    if (Object.getOwnPropertyDescriptor(navigator, 'getGamepads')?.value !== mine) return
    if (own) Object.defineProperty(navigator, 'getGamepads', own)
    else delete (navigator as { getGamepads?: unknown }).getGamepads
  }
}
