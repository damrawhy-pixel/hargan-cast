import { describe, expect, it } from 'vitest'
import { AccountShelf } from '../../src/main/accounts'
import { tune, type Machine } from '../../src/renderer/src/lib/autoTune'
import { gyroToStick, readGyro } from '../../src/renderer/src/lib/gyro'
import { thin } from '../../src/renderer/src/lib/history'

function memoryVault(initial: Record<string, unknown> = {}) {
  let data = { ...initial }
  return {
    snapshot: () => JSON.parse(JSON.stringify(data)),
    replace: (next: Record<string, unknown>) => (data = JSON.parse(JSON.stringify(next))),
    get<T>(key: string, fallback: T): T {
      return (data[key] as T) ?? fallback
    },
    set: (key: string, value: unknown) => (data[key] = JSON.parse(JSON.stringify(value))),
    peek: () => data,
  }
}

describe('account shelf', () => {
  it('parks an account, swaps back and forgets', () => {
    const vault = memoryVault({ npsso: 'first' })
    const shelf = memoryVault()
    const accounts = new AccountShelf(shelf, 'playstation', vault)
    accounts.park('Ana hesap')
    expect(vault.peek()).toEqual({})
    expect(accounts.list().map((a) => a.label)).toEqual(['Ana hesap'])

    vault.replace({ npsso: 'second' })
    const [first] = accounts.list()
    expect(accounts.swap(first.id, 'İkinci')).toBe(true)
    expect(vault.peek()).toEqual({ npsso: 'first' })
    expect(accounts.list().map((a) => a.label)).toEqual(['İkinci'])

    accounts.forget(accounts.list()[0].id)
    expect(accounts.list()).toEqual([])
    expect(accounts.swap('missing', 'x')).toBe(false)
  })

  it('does not park an empty vault', () => {
    const accounts = new AccountShelf(memoryVault(), 'xbox', memoryVault())
    accounts.park('Nobody')
    expect(accounts.list()).toEqual([])
  })
})

describe('auto tune', () => {
  const base: Machine = { refreshHz: 60, screenHeight: 1080, hdr: false, hevc: true, hevc10: true, gpu: 'ANGLE (AMD, Radeon RX 7800 XT)' }

  it('matches a 144 Hz screen, keeps a 120 Hz one', () => {
    expect(tune({ ...base, refreshHz: 144 }, true).changes.matchRefreshRate).toBe(true)
    expect(tune({ ...base, refreshHz: 120 }, true).changes.matchRefreshRate).toBeUndefined()
    expect(tune({ ...base, refreshHz: 144 }, false).changes.matchRefreshRate).toBeUndefined()
  })

  it('sizes PlayStation streams to the line and the screen', () => {
    const fast = tune({ ...base, screenHeight: 2160, downloadMbps: 300, wifi: false }).changes
    expect([fast.psCloudResolution, fast.psCloudBitrate, fast.framePacing, fast.xboxResolution]).toEqual([2160, 100000, 'latency', 1081])
    const slow = tune({ ...base, screenHeight: 2160, downloadMbps: 20, wifi: true }).changes
    expect([slow.psCloudResolution, slow.psCloudBitrate, slow.framePacing, slow.xboxResolution]).toEqual([1080, 10000, 'smooth', 1080])
  })

  it('falls back to H.264 without HEVC and asks for HDR only when it can be shown', () => {
    expect(tune({ ...base, hevc: false }).changes.psCodec).toBe('h264')
    expect(tune({ ...base, hdr: true }).changes.psHdr).toBe(true)
    expect(tune({ ...base, hdr: true, hevc10: false }).changes.psHdr).toBe(false)
  })

  it('gives every change a reason', () => {
    const { reasons } = tune({ ...base, refreshHz: 165, downloadMbps: 80, wifi: true }, true)
    expect(reasons.length).toBeGreaterThanOrEqual(4)
  })
})

describe('gyro aiming', () => {
  it('reads pitch and yaw from USB and Bluetooth reports', () => {
    const usb = new DataView(new ArrayBuffer(64))
    usb.setInt16(15, 164, true)
    usb.setInt16(17, -328, true)
    expect(readGyro(0x01, usb)).toEqual({ pitch: 10, yaw: -20 })
    const bt = new DataView(new ArrayBuffer(78))
    bt.setInt16(16, 164, true)
    expect(readGyro(0x31, bt)?.pitch).toBe(10)
    expect(readGyro(0x05, usb)).toBeUndefined()
  })

  it('steps over the game dead zone and saturates', () => {
    expect(gyroToStick(0, 1)).toBe(0)
    expect(gyroToStick(4, 1)).toBeGreaterThan(0.12)
    expect(gyroToStick(-4, 1)).toBeLessThan(-0.12)
    expect(gyroToStick(5000, 1)).toBe(1)
  })
})

describe('stream history', () => {
  it('thins long sessions to averages, keeping gaps', () => {
    expect(thin([1, 2, 3], 10)).toEqual([1, 2, 3])
    expect(thin([1, 3, 5, 7], 2)).toEqual([2, 6])
    expect(thin([null, null, 4, 6], 2)).toEqual([null, 5])
  })
})
