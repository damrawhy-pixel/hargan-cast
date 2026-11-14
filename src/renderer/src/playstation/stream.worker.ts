// Runs the whole media path off the UI thread: socket, decode, paint.

import { Picture, outputSize, pictureLabel, type Fit, type PictureOptions, type Size } from '../lib/picture'
import type { Message } from '../../../shared/i18n'

/** The canvas's box on screen, in device pixels. */
export interface View extends Size {
  fit: Fit
}

export interface WorkerInit {
  type: 'init'
  url: string
  /**
   * The page's canvas to paint on. Without one, decoded frames go back to the page,
   * which shows them in a <video> so the graphics card can scale them.
   */
  canvas?: OffscreenCanvas
  /** 'smooth' shows canvas frames on the display's refresh instead of on arrival. */
  pacing: 'latency' | 'smooth'
  codec: 'h264' | 'h265'
  audio: MessagePort
  decoder: HardwareAcceleration
  view: View
  /** Post-processing, or undefined to paint frames as they come. */
  picture?: PictureOptions
}

export type WorkerCommand = WorkerInit | { type: 'view'; view: View } | { type: 'input'; report: ArrayBuffer } | { type: 'close' }

export type WorkerEvent =
  /** `filters` is non-empty when post-processing runs; the page words it. */
  | { type: 'stats'; fps: number; mbps: number; lost: number; size: string; filters: string; decodeMs?: number; jitterMs: number; skipped: number }
  | { type: 'firstFrame' }
  /** A decoded frame for the page's <video>; the page closes it. */
  | { type: 'frame'; frame: VideoFrame }
  | { type: 'rumble'; left: number; right: number }
  | { type: 'ended' }
  /** Translated on the page, which knows the interface language. */
  | { type: 'error'; message: Message }

const MEDIA_VIDEO = 1
const MEDIA_AUDIO_FORMAT = 2
const MEDIA_AUDIO_PCM = 3
const MEDIA_RUMBLE = 4
const MEDIA_RESET = 6
const REQUEST_KEY_FRAME = new Uint8Array([2])

const CODECS = { h264: 'avc1.640033', h265: 'hev1.1.6.L153.B0' }
// Decoder failures in a row before giving up on the hardware path, then on the stream.
const DECODER_RETRIES = 3
// Frames waiting in the decoder before the stream is cut back to the next key
// frame: a slow decoder must cost a skip, not a growing delay.
const MAX_DECODE_QUEUE = 6
const KEY_FRAME_REQUEST_MS = 1000

let ws: WebSocket | undefined
let decoder: VideoDecoder | undefined
let canvas: OffscreenCanvas
let ctx: OffscreenCanvasRenderingContext2D | undefined
let picture: Picture | undefined
let view: View
let frameSize: Size = { width: 0, height: 0 }
let audioPort: MessagePort
let codecString = ''
let hardware: HardwareAcceleration = 'prefer-hardware'
let waitingForKey = true
// Chunks carry their arrival time in microseconds, so the decoder sees the real
// cadence and each frame's time from arrival to picture can be measured.
let timestamp = 0
let lastArrival = 0
let lastGap = 0
/** Smoothed change between successive arrival gaps (RFC 3550 style), in ms. */
let jitter = 0
let decodeSum = 0
let decodeCount = 0
/** Frames thrown away while waiting for a key frame. */
let skipped = 0
let firstFrame = true
let decoderFailures = 0
let closing = false
let finished = false
let lastKeyRequest = 0

let frames = 0
let bytes = 0
let lost = 0

// Frames waiting for the next display refresh, in smooth pacing on a canvas. Two is
// enough to ride out a late arrival; more would only add delay, so the oldest goes.
const MAX_PACED = 2
const paced: VideoFrame[] = []
let pacing: WorkerInit['pacing'] = 'latency'
let toPage = false

function presentPaced() {
  if (closing) return
  const frame = paced.shift()
  if (frame) {
    paint(frame)
    frame.close()
  }
  requestAnimationFrame(presentPaced)
}

const post = (e: WorkerEvent) => (self as unknown as Worker).postMessage(e)

// Exactly one 'ended' or 'error' reaches the page, however the stream stops.
function finish(e: Extract<WorkerEvent, { type: 'ended' | 'error' }>) {
  if (finished || closing) return
  finished = true
  post(e)
}

function resize(size: Size) {
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width
    canvas.height = size.height
  }
}

// The stream can change resolution mid-session, so every frame sets the canvas size.
function paint(frame: VideoFrame) {
  frameSize = { width: frame.displayWidth, height: frame.displayHeight }
  if (picture && view.width > 0 && view.height > 0) {
    resize(outputSize(view, frameSize, view.fit))
    picture.draw(frame, frameSize.width, frameSize.height)
  } else {
    // Drawn at its own size; the page scales the canvas.
    resize(frameSize)
    ctx?.drawImage(frame, 0, 0)
  }
}

function createDecoder() {
  decoder?.state !== 'closed' && decoder?.close()
  decoder = new VideoDecoder({
    output(frame) {
      decodeSum += performance.now() - frame.timestamp / 1000
      decodeCount++
      frameSize = { width: frame.displayWidth, height: frame.displayHeight }
      if (toPage) {
        ;(self as unknown as Worker).postMessage({ type: 'frame', frame } satisfies WorkerEvent, [frame])
      } else if (pacing === 'smooth') {
        paced.push(frame)
        while (paced.length > MAX_PACED) {
          paced.shift()!.close()
          skipped++
        }
      } else {
        paint(frame)
        frame.close()
      }
      frames++
      decoderFailures = 0
      if (firstFrame) {
        firstFrame = false
        post({ type: 'firstFrame' })
      }
    },
    error() {
      if (closing) return
      // Hardware decoders die on corrupt input. Rebuild and resync on a key frame;
      // one that keeps failing without a single picture is swapped for software.
      if (++decoderFailures >= DECODER_RETRIES) {
        if (hardware === 'prefer-software') return finish({ type: 'error', message: 'Görüntü çözülemedi. Ayarlardan farklı bir codec dene.' })
        hardware = 'prefer-software'
        decoderFailures = 0
      }
      waitingForKey = true
      createDecoder()
      requestKeyFrame()
    },
  })
  decoder.configure({ codec: codecString, hardwareAcceleration: hardware, optimizeForLatency: true })
}

function onVideo(view: DataView, data: Uint8Array) {
  const key = (view.getUint8(1) & 1) === 1
  lost += view.getUint32(2, true)
  const now = performance.now()
  if (lastArrival) {
    const gap = now - lastArrival
    if (lastGap) jitter += (Math.abs(gap - lastGap) - jitter) / 16
    lastGap = gap
  }
  lastArrival = now
  if (waitingForKey) {
    if (!key) {
      skipped++
      return
    }
    waitingForKey = false
  }
  timestamp = Math.max(timestamp + 1, Math.round(now * 1000))
  if (decoder?.state !== 'configured') return
  if (!key && decoder.decodeQueueSize > MAX_DECODE_QUEUE) {
    skipped++
    waitingForKey = true
    requestKeyFrame()
    return
  }
  decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp, data: data.subarray(6) }))
}

function requestKeyFrame() {
  const now = performance.now()
  if (now - lastKeyRequest < KEY_FRAME_REQUEST_MS || ws?.readyState !== WebSocket.OPEN) return
  lastKeyRequest = now
  ws.send(REQUEST_KEY_FRAME)
}

function onMessage(e: MessageEvent<ArrayBuffer>) {
  const buffer = e.data
  const view = new DataView(buffer)
  const data = new Uint8Array(buffer)
  bytes += buffer.byteLength

  switch (data[0]) {
    case MEDIA_VIDEO:
      onVideo(view, data)
      break
    case MEDIA_AUDIO_FORMAT:
      audioPort.postMessage({ channels: view.getUint32(5, true) })
      break
    case MEDIA_AUDIO_PCM: {
      const pcm = buffer.slice(1)
      audioPort.postMessage(pcm, [pcm])
      break
    }
    case MEDIA_RUMBLE:
      post({ type: 'rumble', left: data[1], right: data[2] })
      break
    case MEDIA_RESET:
      finish({ type: 'ended' })
      break
  }
}

function start(init: WorkerInit) {
  codecString = CODECS[init.codec]
  hardware = init.decoder
  audioPort = init.audio
  view = init.view
  pacing = init.pacing
  toPage = !init.canvas
  if (init.canvas) {
    canvas = init.canvas
    // A canvas keeps the first kind of context it gets, so post-processing is decided once, here.
    if (init.picture) picture = Picture.create(canvas, init.picture)
    if (!picture) {
      ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) ?? undefined
      if (!ctx) return finish({ type: 'error', message: 'Görüntü yüzeyi oluşturulamadı' })
    }
    if (pacing === 'smooth') requestAnimationFrame(presentPaced)
  }
  createDecoder()

  ws = new WebSocket(init.url)
  ws.binaryType = 'arraybuffer'
  ws.onmessage = onMessage
  ws.onerror = () => finish({ type: 'error', message: 'Yerel medya bağlantısı kurulamadı' })
  // The core went away without saying the session ended: the picture would just freeze.
  ws.onclose = () => finish({ type: 'error', message: 'PlayStation bağlantısı beklenmedik şekilde kesildi' })

  setInterval(() => {
    post({
      type: 'stats',
      fps: frames,
      mbps: (bytes * 8) / 1e6,
      lost,
      size: `${frameSize.width}×${frameSize.height}`,
      filters: picture ? pictureLabel(picture.options) : '',
      decodeMs: decodeCount ? decodeSum / decodeCount : undefined,
      jitterMs: jitter,
      skipped,
    })
    frames = bytes = decodeSum = decodeCount = 0
  }, 1000)
}

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const msg = e.data
  if (msg.type === 'init') start(msg)
  else if (msg.type === 'view') view = msg.view
  else if (msg.type === 'input') {
    if (ws?.readyState === WebSocket.OPEN) ws.send(msg.report)
  } else {
    closing = true
    ws?.close()
    if (decoder && decoder.state !== 'closed') decoder.close()
    for (const frame of paced.splice(0)) frame.close()
    picture?.dispose()
  }
}
