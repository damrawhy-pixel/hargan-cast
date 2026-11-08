// Runs the whole media path off the UI thread: socket, decode, paint.

import { Picture, outputSize, pictureLabel, type Fit, type PictureOptions, type Size } from '../lib/picture'

/** The canvas's box on screen, in device pixels. */
export interface View extends Size {
  fit: Fit
}

export interface WorkerInit {
  type: 'init'
  url: string
  canvas: OffscreenCanvas
  codec: 'h264' | 'h265'
  audio: MessagePort
  decoder: HardwareAcceleration
  view: View
  /** Post-processing, or undefined to paint frames as they come. */
  picture?: PictureOptions
}

export type WorkerCommand = WorkerInit | { type: 'view'; view: View } | { type: 'input'; report: ArrayBuffer } | { type: 'close' }

export type WorkerEvent =
  | { type: 'stats'; fps: number; mbps: number; lost: number; size: string; filters: string }
  | { type: 'firstFrame' }
  | { type: 'rumble'; left: number; right: number }
  | { type: 'ended' }
  | { type: 'error'; message: string }

const MEDIA_VIDEO = 1
const MEDIA_AUDIO_FORMAT = 2
const MEDIA_AUDIO_PCM = 3
const MEDIA_RUMBLE = 4
const MEDIA_RESET = 6
const REQUEST_KEY_FRAME = new Uint8Array([2])

const CODECS = { h264: 'avc1.640033', h265: 'hev1.1.6.L153.B0' }

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
let timestamp = 0
let firstFrame = true

let frames = 0
let bytes = 0
let lost = 0

const post = (e: WorkerEvent) => (self as unknown as Worker).postMessage(e)

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
      paint(frame)
      frame.close()
      frames++
      if (firstFrame) {
        firstFrame = false
        post({ type: 'firstFrame' })
      }
    },
    error() {
      // Hardware decoders die on corrupt input. Rebuild and resync on a key frame.
      waitingForKey = true
      createDecoder()
      ws?.send(REQUEST_KEY_FRAME)
    },
  })
  decoder.configure({ codec: codecString, hardwareAcceleration: hardware, optimizeForLatency: true })
}

function onVideo(view: DataView, data: Uint8Array) {
  const key = (view.getUint8(1) & 1) === 1
  lost += view.getUint32(2, true)
  if (waitingForKey) {
    if (!key) return
    waitingForKey = false
  }
  timestamp += 16667
  decoder!.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp, data: data.subarray(6) }))
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
      post({ type: 'ended' })
      break
  }
}

function start(init: WorkerInit) {
  codecString = CODECS[init.codec]
  hardware = init.decoder
  audioPort = init.audio
  canvas = init.canvas
  view = init.view
  // A canvas keeps the first kind of context it gets, so post-processing is decided once, here.
  if (init.picture) picture = Picture.create(canvas, init.picture)
  if (!picture) {
    ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) ?? undefined
    if (!ctx) return post({ type: 'error', message: 'Görüntü yüzeyi oluşturulamadı' })
  }
  createDecoder()

  ws = new WebSocket(init.url)
  ws.binaryType = 'arraybuffer'
  ws.onmessage = onMessage
  ws.onerror = () => post({ type: 'error', message: 'Yerel medya bağlantısı kurulamadı' })

  setInterval(() => {
    post({ type: 'stats', fps: frames, mbps: (bytes * 8) / 1e6, lost, size: `${frameSize.width}×${frameSize.height}`, filters: picture ? pictureLabel(picture.options) : '' })
    frames = bytes = 0
  }, 1000)
}

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const msg = e.data
  if (msg.type === 'init') start(msg)
  else if (msg.type === 'view') view = msg.view
  else if (msg.type === 'input') {
    if (ws?.readyState === WebSocket.OPEN) ws.send(msg.report)
  } else {
    ws?.close()
    if (decoder && decoder.state !== 'closed') decoder.close()
    picture?.dispose()
  }
}
