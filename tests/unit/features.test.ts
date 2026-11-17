import { afterEach, describe, expect, it } from 'vitest'
import { assistMatrix, svgMatrix } from '../../src/renderer/src/lib/colorAssist'
import { pictureActive, pictureLabel, pictureOptionsFor } from '../../src/renderer/src/lib/picture'
import { formatButtonMap, installLayout, parseButtonMap } from '../../src/renderer/src/lib/remap'
import { reconnectable } from '../../src/renderer/src/playstation/stages'
import { accountIdBase64, remoteStreamArgs, validAccountId } from '../../src/main/playstation/common'
import { launchTarget } from '../../src/main/launch'
import { captureName, safeName } from '../../src/main/names'
import { parseVdf, shortcutAppId, writeVdf } from '../../src/main/steam'
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/shared/settings'

describe('controller layout', () => {
  const swapAB = [1, 0, ...Array.from({ length: 16 }, (_, i) => i + 2)]

  it('reads and writes the stored button map', () => {
    expect(parseButtonMap('')).toEqual(Array.from({ length: 18 }, (_, i) => i))
    expect(parseButtonMap(swapAB.join(','))).toEqual(swapAB)
    expect(parseButtonMap('1,2,3')).toEqual(parseButtonMap(''))
    expect(formatButtonMap(parseButtonMap(''))).toBe('')
    expect(formatButtonMap(swapAB)).toBe(swapAB.join(','))
  })

  it('only stores valid maps', () => {
    expect(sanitizeSettings({ buttonMap: swapAB.join(',') })).toEqual({ buttonMap: swapAB.join(',') })
    expect(sanitizeSettings({ buttonMap: '1,0,18' })).toEqual({})
    expect(sanitizeSettings({ buttonMap: '' })).toEqual({ buttonMap: '' })
  })

  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
  })

  it('remaps standard controllers while installed and stops after', () => {
    const button = (value: number) => ({ pressed: value > 0.5, touched: value > 0, value })
    const pad = { id: 'pad', index: 0, connected: true, mapping: 'standard', timestamp: 1, axes: [0.1, 0.2, 0.3, 0.4], buttons: [button(1), button(0), ...Array.from({ length: 16 }, () => button(0))], vibrationActuator: 'motor' }
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } })
    const remove = installLayout({ map: swapAB, swapSticks: true, invertY: true })
    const seen = (navigator.getGamepads() as unknown as (typeof pad)[])[0]
    expect(seen.buttons[0].pressed).toBe(false)
    expect(seen.buttons[1].pressed).toBe(true)
    expect(seen.axes).toEqual([0.3, 0.4, 0.1, -0.2])
    // Rumble still reaches the real controller.
    expect(seen.vibrationActuator).toBe('motor')
    remove()
    expect((navigator.getGamepads() as unknown as (typeof pad)[])[0]).toBe(pad)
  })
})

describe('picture options', () => {
  it('follows each service setting', () => {
    const ps = pictureOptionsFor({ ...DEFAULT_SETTINGS, psScaler: 'lanczos', psDenoise: true }, 'ps')
    expect(ps).toEqual({ scaler: 'lanczos', sharpness: DEFAULT_SETTINGS.psFsrSharpness, deband: true, denoise: true })
    expect(pictureLabel(ps)).toContain('Lanczos')
    const xbox = pictureOptionsFor({ ...DEFAULT_SETTINGS, xboxFsr: false }, 'xbox')
    expect(xbox.scaler).toBe('off')
    expect(pictureActive(xbox)).toBe(false)
  })
})

describe('colour-blindness correction', () => {
  it('leaves white and grey alone', () => {
    for (const kind of ['protan', 'deutan', 'tritan'] as const) {
      const m = assistMatrix(kind)
      for (let r = 0; r < 3; r++) expect(m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2]).toBeCloseTo(1, 2)
      expect(svgMatrix(kind).split(' ')).toHaveLength(20)
    }
  })
})

describe('PlayStation', () => {
  it('reconnects only after network failures', () => {
    expect(reconnectable('Unknown Error in Stream Connection')).toBe(true)
    expect(reconnectable('Remote has disconnected from Stream Connection')).toBe(true)
    expect(reconnectable('Remote has disconnected from Stream Connection the because Server shut down')).toBe(false)
    expect(reconnectable('Remote Play on Console is already in use')).toBe(false)
    expect(reconnectable('Stopped')).toBe(false)
  })

  it('turns the PSN account id into the 8 bytes a console wants', () => {
    const id = accountIdBase64('1234567890123456789')
    expect(atob(id).length).toBe(8)
    expect(validAccountId(id)).toBe(true)
    expect(validAccountId('not base64!')).toBe(false)
    // Little-endian: the low byte first.
    expect(atob(accountIdBase64('258')).charCodeAt(0)).toBe(2)
  })

  it('asks a PS4 for 1080p at most and only a PS5 for HDR', () => {
    const settings = { ...DEFAULT_SETTINGS, psRemoteResolution: 2160 }
    const ps4 = remoteStreamArgs({ address: '10.0.0.2', ps5: false }, { hevc: true, hdr: true }, settings)
    expect([ps4.resolution, ps4.hevc, ps4.hdr]).toEqual([1080, false, false])
    const ps5 = remoteStreamArgs({ address: '10.0.0.3', ps5: true }, { hevc: true, hdr: true }, settings)
    expect([ps5.resolution, ps5.hevc, ps5.hdr, ps5.bitrate]).toEqual([2160, true, true, 40000])
  })
})

describe('launch targets', () => {
  it('reads shortcuts and links, nothing else', () => {
    expect(launchTarget(['app.exe', '--play=xbox:9NBLGGH4R315'])).toBe('xbox:9NBLGGH4R315')
    expect(launchTarget(['app.exe', 'hargancast://play/ps:EP0001-CUSA00000_00'])).toBe('ps:EP0001-CUSA00000_00')
    expect(launchTarget(['app.exe', 'hargancast://console/ps:1A2B3C/'])).toBe('console:ps:1A2B3C')
    expect(launchTarget(['app.exe', '--play=xbox:../../evil'])).toBeUndefined()
    expect(launchTarget(['app.exe', '--play=file:C:/x'])).toBeUndefined()
  })
})

describe('file names', () => {
  it('drops what Windows forbids and stamps the time', () => {
    expect(safeName('Halo: Infinite / "Remastered"?')).toBe('Halo Infinite Remastered')
    expect(safeName('\u0007')).toBe('Hargan Cast')
    expect(captureName('Forza', new Date(2026, 10, 17, 21, 5, 9))).toBe('Forza 2026-11-17 21-05-09')
  })
})

describe('Steam shortcuts', () => {
  it('writes and reads back the binary format', () => {
    const vdf = { shortcuts: { '0': { appid: shortcutAppId('"C:\\Hargan Cast.exe"', 'Forza'), AppName: 'Forza', IsHidden: 0, tags: {} } } }
    expect(parseVdf(writeVdf(vdf))).toEqual(vdf)
  })

  it('gives non-Steam games ids with the top bit set', () => {
    expect(shortcutAppId('"x.exe"', 'Game')).toBeLessThan(0)
  })
})
