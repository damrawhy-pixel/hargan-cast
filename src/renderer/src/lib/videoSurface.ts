// Shows decoded frames in a <video> instead of a canvas. A video element is what
// the graphics drivers' own upscalers (NVIDIA RTX Video, Intel VSR) act on, and
// Chromium can hand it to the display as a hardware overlay, skipping the
// compositor: sharper scaling and steadier, lower-latency presentation.

interface Generator extends MediaStreamTrack {
  readonly writable: WritableStream<VideoFrame>
}
type GeneratorConstructor = new (init: { kind: 'video' }) => Generator

const GeneratorClass = (globalThis as unknown as { MediaStreamTrackGenerator?: GeneratorConstructor }).MediaStreamTrackGenerator

/** False where the browser cannot feed frames to a video element (older WebKit). */
export const videoSurfaceSupported = Boolean(GeneratorClass)

// Frames held for the next refresh in smooth pacing; more would only add delay.
const MAX_PACED = 2

export function startVideoSurface(video: HTMLVideoElement, pacing: 'latency' | 'smooth') {
  const track = new GeneratorClass!({ kind: 'video' })
  const writer = track.writable.getWriter()
  video.muted = true
  video.playsInline = true
  video.srcObject = new MediaStream([track])
  void video.play().catch(() => {})

  let dropped = 0
  let frame = 0
  const paced: VideoFrame[] = []

  // The writer owns a frame once it takes it. When the video path is still busy
  // with the last one, a new frame is dropped rather than queued behind it.
  const write = (f: VideoFrame) => {
    if ((writer.desiredSize ?? 1) <= 0) {
      f.close()
      dropped++
      return
    }
    void writer.write(f).catch(() => f.close())
  }

  const tick = () => {
    const next = paced.shift()
    if (next) write(next)
    frame = requestAnimationFrame(tick)
  }
  if (pacing === 'smooth') frame = requestAnimationFrame(tick)

  return {
    push(f: VideoFrame) {
      if (pacing === 'latency') return write(f)
      paced.push(f)
      while (paced.length > MAX_PACED) {
        paced.shift()!.close()
        dropped++
      }
    },
    /** Frames dropped so far to keep up. */
    dropped: () => dropped,
    dispose() {
      cancelAnimationFrame(frame)
      for (const f of paced.splice(0)) f.close()
      void writer.close().catch(() => {})
      track.stop()
      video.srcObject = null
    },
  }
}
