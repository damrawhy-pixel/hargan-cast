import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/shared/settings'

describe('sanitizeSettings', () => {
  it('keeps every default untouched', () => {
    expect(sanitizeSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
  })

  it('drops unknown fields and values of the wrong kind', () => {
    expect(sanitizeSettings({ evil: 1, useVulkan: 'true', fontSize: '16', audioVolume: 70 })).toEqual({ audioVolume: 70 })
  })

  it('accepts only the offered choices', () => {
    expect(sanitizeSettings({ motion: 'system', psCodec: 'h266', videoFormat: '21:9' })).toEqual({ motion: 'system', videoFormat: '21:9' })
  })

  it('pulls numbers into the range the settings page offers', () => {
    expect(sanitizeSettings({ fontSize: 99, psDeadZone: -5, xboxMouseSensitivity: 0.5 })).toEqual({ fontSize: 20, psDeadZone: 0, xboxMouseSensitivity: 0.5 })
  })

  it('rejects non-finite numbers and oversized text', () => {
    expect(sanitizeSettings({ audioVolume: NaN, brightness: Infinity, xboxTurnUrl: 'x'.repeat(600) })).toEqual({})
  })

  it('keeps values without a fixed range when they are sane', () => {
    expect(sanitizeSettings({ xboxResolution: 1081, psCloudBitrate: 25000 })).toEqual({ xboxResolution: 1081, psCloudBitrate: 25000 })
  })

  it('treats anything that is not an object as empty', () => {
    for (const input of [null, undefined, 'x', 3, []]) expect(sanitizeSettings(input)).toEqual({})
  })
})
