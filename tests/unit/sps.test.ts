import { describe, expect, it } from 'vitest'
import { decoderConfig, dynamicRange, nalUnits, readFormat } from '../../src/renderer/src/lib/sps'

// Writes bits the way an encoder lays out a parameter set, so each field the
// parser reads can be chosen here and checked on the way back.
class Writer {
  private bits: number[] = []
  u(n: number, v: number) {
    for (let i = n - 1; i >= 0; i--) this.bits.push(Math.floor(v / 2 ** i) % 2)
    return this
  }
  ue(v: number) {
    const len = Math.floor(Math.log2(v + 1))
    this.u(len, 0)
    return this.u(len + 1, v + 1)
  }
  se(v: number) {
    return this.ue(v <= 0 ? -2 * v : 2 * v - 1)
  }
  bytes() {
    const out = [...this.bits, 1]
    while (out.length % 8) out.push(0)
    const bytes: number[] = []
    for (let i = 0; i < out.length; i += 8) bytes.push(parseInt(out.slice(i, i + 8).join(''), 2))
    // Escape 00 00 0x like an encoder must.
    const escaped: number[] = []
    let zeros = 0
    for (const b of bytes) {
      if (zeros >= 2 && b <= 3) {
        escaped.push(3)
        zeros = 0
      }
      escaped.push(b)
      zeros = b === 0 ? zeros + 1 : 0
    }
    return escaped
  }
}

type Vui = { fullRange?: boolean; color?: [number, number, number] }

function vui(w: Writer, v?: Vui) {
  if (!v) return w.u(1, 0)
  w.u(1, 1) // vui present
  w.u(1, 1).u(8, 255).u(16, 1).u(16, 1) // aspect ratio, extended
  w.u(1, 0) // overscan
  w.u(1, 1).u(3, 5).u(1, v.fullRange ? 1 : 0) // signal type
  if (v.color) w.u(1, 1).u(8, v.color[0]).u(8, v.color[1]).u(8, v.color[2])
  else w.u(1, 0)
  return w
}

function h264Sps(o: { profile?: number; level?: number; scaling?: boolean; vui?: Vui; width?: number; height?: number }) {
  const w = new Writer()
  const profile = o.profile ?? 100
  w.u(8, profile).u(8, 0).u(8, o.level ?? 51).ue(0)
  if (profile === 100) {
    w.ue(1).ue(0).ue(0).u(1, 0)
    if (o.scaling) {
      w.u(1, 1)
      for (let i = 0; i < 8; i++) {
        w.u(1, i === 0 ? 1 : 0)
        if (i === 0) for (let j = 0; j < 16; j++) w.se(j === 0 ? 4 : 0)
      }
    } else w.u(1, 0)
  }
  w.ue(0).ue(0).ue(4) // frame num, poc type 0 and its lsb
  w.ue(4).u(1, 0)
  const width = o.width ?? 1920
  const height = o.height ?? 1080
  const mbsH = Math.ceil(height / 16)
  w.ue(width / 16 - 1).ue(mbsH - 1).u(1, 1).u(1, 1)
  const crop = mbsH * 16 - height
  if (crop) w.u(1, 1).ue(0).ue(0).ue(0).ue(crop / 2)
  else w.u(1, 0)
  vui(w, o.vui)
  return [0, 0, 0, 1, 0x67, ...w.bytes()]
}

function h265Sps(o: { profile: number; level: number; bitDepth: number; vui?: Vui; sets?: boolean }) {
  const w = new Writer()
  w.u(4, 0).u(3, 0).u(1, 1)
  // profile_tier_level: Main is compatible with 1 and 2, Main 10 with 2.
  const compat = o.profile === 1 ? 0x60000000 : 0x20000000
  w.u(2, 0).u(1, 0).u(5, o.profile).u(32, compat).u(8, 0xb0).u(8, 0).u(8, 0).u(8, 0).u(8, 0).u(8, 0).u(8, o.level)
  w.ue(0).ue(1).ue(3840).ue(2160).u(1, 0).ue(o.bitDepth - 8).ue(o.bitDepth - 8).ue(4).u(1, 1)
  w.ue(4).ue(0).ue(0) // ordering info
  w.ue(0).ue(3).ue(0).ue(3).ue(0).ue(0)
  w.u(1, 0).u(1, 0).u(1, 1).u(1, 0) // scaling off, amp, sao, pcm off
  if (o.sets) {
    // Two short-term sets, the second predicted from the first.
    w.ue(2)
    w.ue(2).ue(1).ue(0).u(1, 1).ue(1).u(1, 0).ue(0).u(1, 1)
    w.u(1, 1).u(1, 0).ue(0)
    for (let j = 0; j <= 3; j++) {
      const used = j % 2
      w.u(1, used)
      if (!used) w.u(1, 1)
    }
  } else w.ue(0)
  w.u(1, 0).u(1, 1).u(1, 0) // long term off, tmvp, strong intra
  vui(w, o.vui)
  return [0, 0, 0, 1, 0x42, 0x01, ...w.bytes()]
}

// A frame's slice after the parameter sets, so the parser has to find the SPS among others.
const SLICE_264 = [0, 0, 1, 0x65, 0x88, 0x84]
const SLICE_265 = [0, 0, 1, 0x26, 0x01, 0xaf]

describe('readFormat', () => {
  it('reads an H.264 stream without colour information as needing the HD default', () => {
    const format = readFormat(new Uint8Array([...h264Sps({}), ...SLICE_264]), 'h264')!
    expect(format.codec).toBe('avc1.640033')
    expect([format.width, format.height, format.bitDepth]).toEqual([1920, 1080, 8])
    expect(format.color).toBeUndefined()
    expect(decoderConfig(format, 'prefer-hardware').colorSpace).toEqual({ primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false })
  })

  it('reads colour, range and a scaling matrix from H.264', () => {
    const format = readFormat(new Uint8Array(h264Sps({ scaling: true, level: 42, vui: { fullRange: true, color: [1, 1, 1] } })), 'h264')!
    expect(format.codec).toBe('avc1.64002a')
    expect(format.color).toEqual({ primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: true })
    // Colours in the stream win: the decoder is told nothing extra.
    expect(decoderConfig(format, 'prefer-hardware').colorSpace).toBeUndefined()
  })

  it('keeps a full range the stream gives without a colour description', () => {
    const format = readFormat(new Uint8Array(h264Sps({ vui: { fullRange: true } })), 'h264')!
    expect(format.color).toBeUndefined()
    expect(decoderConfig(format, 'prefer-software').colorSpace?.fullRange).toBe(true)
  })

  it('names an HEVC Main stream the way the browser expects', () => {
    const format = readFormat(new Uint8Array([...h265Sps({ profile: 1, level: 153, bitDepth: 8 }), ...SLICE_265]), 'h265')!
    expect(format.codec).toBe('hev1.1.6.L153.B0')
    expect([format.width, format.height, format.bitDepth]).toEqual([3840, 2160, 8])
  })

  it('recognises 10-bit HDR10 in HEVC Main 10, past predicted reference sets', () => {
    const format = readFormat(new Uint8Array(h265Sps({ profile: 2, level: 156, bitDepth: 10, sets: true, vui: { color: [9, 16, 9] } })), 'h265')!
    expect(format.codec).toBe('hev1.2.4.L156.B0')
    expect(format.bitDepth).toBe(10)
    expect(format.color).toEqual({ primaries: 'bt2020', transfer: 'pq', matrix: 'bt2020-ncl', fullRange: false })
    expect(dynamicRange(format.color)).toBe('HDR10')
  })

  it('gives up quietly on a frame without parameters or a broken one', () => {
    expect(readFormat(new Uint8Array(SLICE_264), 'h264')).toBeUndefined()
    expect(readFormat(new Uint8Array([0, 0, 1, 0x67, 0x64]), 'h264')).toBeUndefined()
  })
})

describe('nalUnits', () => {
  it('splits on three- and four-byte start codes', () => {
    const units = [...nalUnits(new Uint8Array([0, 0, 0, 1, 9, 9, 0, 0, 1, 7, 0, 0, 0, 1, 5]))].map((u) => [...u])
    expect(units).toEqual([[9, 9], [7], [5]])
  })
})

describe('dynamicRange', () => {
  it('names SDR, HDR10 and HLG', () => {
    expect(dynamicRange({ transfer: 'bt709' })).toBe('SDR')
    expect(dynamicRange({ transfer: 'hlg' })).toBe('HLG')
    expect(dynamicRange(null)).toBe('SDR')
  })
})
