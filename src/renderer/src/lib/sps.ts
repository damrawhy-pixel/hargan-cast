// Reads a video stream's sequence parameter set (H.264 or H.265), the header that
// says what the picture really is: profile and level, bit depth, and the colour
// space the encoder used. The decoder is configured from it, so a 10-bit HDR stream
// gets a 10-bit decoder and a stream that names no colours is shown as BT.709, the
// standard for HD video, instead of whatever the decoder guesses.

// WebCodecs' names; TypeScript's own lists lag behind (no HDR ones), so plain strings.
export interface StreamColor {
  primaries: string | null
  transfer: string | null
  matrix: string | null
  fullRange: boolean
}

export interface StreamFormat {
  /** WebCodecs codec string, e.g. avc1.640033 or hev1.2.4.L153.B0. */
  codec: string
  bitDepth: number
  width: number
  height: number
  /** undefined when the stream does not describe its colours. */
  color?: StreamColor
  /** Only the range is known: the stream gave its signal type but no colour description. */
  fullRange?: boolean
}

export type DynamicRange = 'SDR' | 'HDR10' | 'HLG'

const PRIMARIES: Record<number, string> = { 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m', 9: 'bt2020', 12: 'smpte432' }
const TRANSFER: Record<number, string> = { 1: 'bt709', 6: 'smpte170m', 8: 'linear', 13: 'iec61966-2-1', 16: 'pq', 18: 'hlg' }
const MATRIX: Record<number, string> = { 0: 'rgb', 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m', 9: 'bt2020-ncl' }

/** What the decoder is told when the stream names no colours: HD video's standard. */
export const DEFAULT_COLOR: VideoColorSpaceInit = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false }

export function dynamicRange(color: { transfer?: string | null } | null | undefined): DynamicRange {
  return color?.transfer === 'pq' ? 'HDR10' : color?.transfer === 'hlg' ? 'HLG' : 'SDR'
}

class Bits {
  private bit = 0
  constructor(private data: Uint8Array) {}

  u(n: number): number {
    let v = 0
    for (let i = 0; i < n; i++) {
      const byte = this.data[this.bit >> 3]
      if (byte === undefined) throw new RangeError('sps')
      v = v * 2 + ((byte >> (7 - (this.bit & 7))) & 1)
      this.bit++
    }
    return v
  }

  skip(n: number) {
    this.bit += n
    if (this.bit > this.data.length * 8) throw new RangeError('sps')
  }

  ue(): number {
    let zeros = 0
    while (this.u(1) === 0) if (++zeros > 31) throw new RangeError('sps')
    return 2 ** zeros - 1 + this.u(zeros)
  }

  se(): number {
    const v = this.ue()
    return v & 1 ? (v + 1) / 2 : -v / 2
  }
}

// NAL payloads escape 00 00 0x as 00 00 03 0x; the parser wants the plain bytes.
function unescape(nal: Uint8Array): Uint8Array {
  const out = new Uint8Array(nal.length)
  let n = 0
  let zeros = 0
  for (const b of nal) {
    if (zeros >= 2 && b === 3) {
      zeros = 0
      continue
    }
    out[n++] = b
    zeros = b === 0 ? zeros + 1 : 0
  }
  return out.subarray(0, n)
}

/** The NAL units of an Annex B access unit, each without its start code. */
export function* nalUnits(au: Uint8Array): Generator<Uint8Array> {
  let start = -1
  for (let i = 0; i + 2 < au.length; i++) {
    if (au[i] === 0 && au[i + 1] === 0 && au[i + 2] === 1) {
      if (start >= 0) {
        // A four-byte start code leaves its leading zero on the previous unit.
        let end = i
        if (end > start && au[end - 1] === 0) end--
        yield au.subarray(start, end)
      }
      start = i + 3
      i += 2
    }
  }
  if (start >= 0 && start < au.length) yield au.subarray(start)
}

function vui(r: Bits): Pick<StreamFormat, 'color' | 'fullRange'> {
  if (r.u(1)) {
    // aspect_ratio_info
    if (r.u(8) === 255) r.skip(32)
  }
  if (r.u(1)) r.skip(1) // overscan
  if (!r.u(1)) return {} // video_signal_type
  r.skip(3) // video_format
  const fullRange = r.u(1) === 1
  if (!r.u(1)) return { fullRange }
  const p = r.u(8)
  const t = r.u(8)
  const m = r.u(8)
  return { color: { primaries: PRIMARIES[p] ?? null, transfer: TRANSFER[t] ?? null, matrix: MATRIX[m] ?? null, fullRange } }
}

const hex2 = (v: number) => v.toString(16).padStart(2, '0')

function h264(nal: Uint8Array): StreamFormat {
  const r = new Bits(unescape(nal.subarray(1)))
  const profile = r.u(8)
  const constraints = r.u(8)
  const level = r.u(8)
  r.ue() // seq_parameter_set_id
  let chroma = 1
  let bitDepth = 8
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
    chroma = r.ue()
    if (chroma === 3) r.skip(1)
    bitDepth = r.ue() + 8
    r.ue() // chroma bit depth
    r.skip(1)
    if (r.u(1)) {
      for (let i = 0; i < (chroma !== 3 ? 8 : 12); i++) {
        if (!r.u(1)) continue
        let last = 8
        let next = 8
        for (let j = 0; j < (i < 6 ? 16 : 64); j++) {
          if (next !== 0) next = (last + r.se() + 256) % 256
          last = next === 0 ? last : next
        }
      }
    }
  }
  r.ue() // log2_max_frame_num
  const pocType = r.ue()
  if (pocType === 0) r.ue()
  else if (pocType === 1) {
    r.skip(1)
    r.se()
    r.se()
    const cycle = r.ue()
    for (let i = 0; i < cycle; i++) r.se()
  }
  r.ue() // max_num_ref_frames
  r.skip(1)
  const widthMbs = r.ue() + 1
  const heightUnits = r.ue() + 1
  const frameMbsOnly = r.u(1)
  if (!frameMbsOnly) r.skip(1)
  r.skip(1)
  let crop = [0, 0, 0, 0]
  if (r.u(1)) crop = [r.ue(), r.ue(), r.ue(), r.ue()]
  // Crop units are two pixels for 4:2:0 (and twice that vertically for field coding).
  const cropX = chroma === 0 || chroma === 3 ? 1 : 2
  const cropY = (chroma === 1 ? 2 : 1) * (2 - frameMbsOnly)
  const width = widthMbs * 16 - (crop[0] + crop[1]) * cropX
  const height = heightUnits * 16 * (2 - frameMbsOnly) - (crop[2] + crop[3]) * cropY
  const described = r.u(1) ? vui(r) : {}
  return { codec: `avc1.${hex2(profile)}${hex2(constraints)}${hex2(level)}`, bitDepth, width, height, ...described }
}

function reverse32(v: number) {
  let out = 0
  for (let i = 0; i < 32; i++) out = out * 2 + ((v >>> i) & 1)
  return out
}

function h265(nal: Uint8Array): StreamFormat {
  const r = new Bits(unescape(nal.subarray(2)))
  r.skip(4) // sps_video_parameter_set_id
  const subLayers = r.u(3)
  r.skip(1)
  // profile_tier_level
  const space = r.u(2)
  const tier = r.u(1)
  const profile = r.u(5)
  const compat = r.u(32)
  const constraint: number[] = []
  for (let i = 0; i < 6; i++) constraint.push(r.u(8))
  const level = r.u(8)
  const profilePresent: number[] = []
  const levelPresent: number[] = []
  for (let i = 0; i < subLayers; i++) {
    profilePresent.push(r.u(1))
    levelPresent.push(r.u(1))
  }
  if (subLayers > 0) for (let i = subLayers; i < 8; i++) r.skip(2)
  for (let i = 0; i < subLayers; i++) {
    if (profilePresent[i]) r.skip(88)
    if (levelPresent[i]) r.skip(8)
  }
  r.ue() // sps_seq_parameter_set_id
  const chroma = r.ue()
  if (chroma === 3) r.skip(1)
  let width = r.ue()
  let height = r.ue()
  if (r.u(1)) {
    const [left, right, top, bottom] = [r.ue(), r.ue(), r.ue(), r.ue()]
    const sx = chroma === 1 || chroma === 2 ? 2 : 1
    const sy = chroma === 1 ? 2 : 1
    width -= (left + right) * sx
    height -= (top + bottom) * sy
  }
  const bitDepth = r.ue() + 8
  r.ue() // chroma bit depth
  const pocBits = r.ue() + 4
  const ordering = r.u(1)
  for (let i = ordering ? 0 : subLayers; i <= subLayers; i++) {
    r.ue()
    r.ue()
    r.ue()
  }
  for (let i = 0; i < 6; i++) r.ue() // block and transform sizes, hierarchy depths
  if (r.u(1) && r.u(1)) {
    // scaling_list_data
    for (let size = 0; size < 4; size++) {
      for (let matrix = 0; matrix < 6; matrix += size === 3 ? 3 : 1) {
        if (!r.u(1)) r.ue()
        else {
          const coefs = Math.min(64, 1 << (4 + (size << 1)))
          if (size > 1) r.se()
          for (let i = 0; i < coefs; i++) r.se()
        }
      }
    }
  }
  r.skip(2) // amp, sample adaptive offset
  if (r.u(1)) {
    // pcm
    r.skip(8)
    r.ue()
    r.ue()
    r.skip(1)
  }
  const sets = r.ue()
  const deltaPocs: number[] = []
  for (let i = 0; i < sets; i++) {
    if (i !== 0 && r.u(1)) {
      // Predicted from the set before it.
      r.skip(1)
      r.ue()
      let count = 0
      for (let j = 0; j <= deltaPocs[i - 1]; j++) {
        const used = r.u(1)
        const useDelta = used ? 1 : r.u(1)
        if (used || useDelta) count++
      }
      deltaPocs.push(count)
    } else {
      const negative = r.ue()
      const positive = r.ue()
      for (let j = 0; j < negative + positive; j++) {
        r.ue()
        r.skip(1)
      }
      deltaPocs.push(negative + positive)
    }
  }
  if (r.u(1)) {
    const longTerm = r.ue()
    for (let i = 0; i < longTerm; i++) r.skip(pocBits + 1)
  }
  r.skip(2) // temporal mvp, strong intra smoothing
  const described = r.u(1) ? vui(r) : {}

  const spaceLetter = space ? 'ABC'[space - 1] : ''
  while (constraint.length && constraint[constraint.length - 1] === 0) constraint.pop()
  const codec = [`hev1`, `${spaceLetter}${profile}`, reverse32(compat).toString(16).toUpperCase(), `${tier ? 'H' : 'L'}${level}`, ...constraint.map((b) => b.toString(16).toUpperCase())].join('.')
  return { codec, bitDepth, width, height, ...described }
}

/** The format the access unit's SPS describes, or undefined when it has none or it cannot be read. */
export function readFormat(au: Uint8Array, codec: 'h264' | 'h265'): StreamFormat | undefined {
  for (const nal of nalUnits(au)) {
    if (!nal.length) continue
    const type = codec === 'h264' ? nal[0] & 0x1f : (nal[0] >> 1) & 0x3f
    if (type !== (codec === 'h264' ? 7 : 33)) continue
    try {
      return codec === 'h264' ? h264(nal) : h265(nal)
    } catch {
      return undefined
    }
  }
  return undefined
}

/** The decoder settings for a stream: its own codec string, and BT.709 when it names no colours. */
export function decoderConfig(format: StreamFormat, hardwareAcceleration: HardwareAcceleration): VideoDecoderConfig {
  const config: VideoDecoderConfig = { codec: format.codec, hardwareAcceleration, optimizeForLatency: true }
  if (!format.color) config.colorSpace = { ...DEFAULT_COLOR, fullRange: format.fullRange ?? false }
  return config
}
