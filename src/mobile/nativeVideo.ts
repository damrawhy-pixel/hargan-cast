// window.hc.ps.nativeVideo on Android: the stream's picture through the phone's
// own MediaCodec onto a surface under the web view (see NativeVideo.java).
import { Capacitor } from '@capacitor/core'
import type { NativeVideoApi, NativeVideoStats, NativeVideoTest } from '../shared/types'
import { PsCore } from './native'

const toBase64 = (bytes: Uint8Array) => {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

// A one-second H.264 clip made right here, in the same Annex B form the core hands over.
async function testClip(width: number, height: number) {
  const units: string[] = []
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      units.push(toBase64(data))
    },
    error: () => {},
  })
  encoder.configure({ codec: 'avc1.42E01E', width, height, bitrate: 2_000_000, framerate: 30, avc: { format: 'annexb' } })
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `hsl(${i * 12} 80% 50%)`
    ctx.fillRect(0, 0, width, height)
    const frame = new VideoFrame(canvas, { timestamp: i * 33_333 })
    encoder.encode(frame, { keyFrame: i === 0 })
    frame.close()
  }
  await encoder.flush()
  encoder.close()
  return units
}

export function nativeVideo(): NativeVideoApi | undefined {
  if (Capacitor.getPlatform() !== 'android') return undefined
  return {
    async test(): Promise<NativeVideoTest> {
      const units = await testClip(640, 360)
      return PsCore.nativeVideoTest({ units, hevc: false, width: 640, height: 360 })
    },
    start: (options) => PsCore.nativeVideoStart(options),
    stop: () => PsCore.nativeVideoStop(),
    onStats(cb: (stats: NativeVideoStats) => void) {
      const handle = PsCore.addListener('nativeVideo', cb)
      return () => void handle.then((h) => h.remove())
    },
  }
}
