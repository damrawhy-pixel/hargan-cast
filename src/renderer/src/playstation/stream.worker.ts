// Runs the whole media path off the UI thread: socket, decode, paint.

export interface WorkerInit {
  type: 'init'
  url: string
  canvas: OffscreenCanvas
  codec: 'h264' | 'h265'
  audio: MessagePort
  decoder: HardwareAcceleration
}

export type WorkerCommand = WorkerInit | { type: 'input'; report: ArrayBuffer } | { type: 'close' }

export type WorkerEvent =
  | { type: 'stats'; fps: number; mbps: number; lost: number }
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
let ctx: OffscreenCanvasRenderingContext2D
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

function createDecoder() {
  decoder?.state !== 'closed' && decoder?.close()
  decoder = new VideoDecoder({
    output(frame) {
      ctx.drawImage(frame, 0, 0, ctx.canvas.width, ctx.canvas.height)
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
  const context = init.canvas.getContext('2d', { alpha: false, desynchronized: true })
  if (!context) return post({ type: 'error', message: 'Görüntü yüzeyi oluşturulamadı' })
  ctx = context
  createDecoder()

  ws = new WebSocket(init.url)
  ws.binaryType = 'arraybuffer'
  ws.onmessage = onMessage
  ws.onerror = () => post({ type: 'error', message: 'Yerel medya bağlantısı kurulamadı' })

  setInterval(() => {
    post({ type: 'stats', fps: frames, mbps: (bytes * 8) / 1e6, lost })
    frames = bytes = 0
  }, 1000)
}

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const msg = e.data
  if (msg.type === 'init') start(msg)
  else if (msg.type === 'input') {
    if (ws?.readyState === WebSocket.OPEN) ws.send(msg.report)
  } else {
    ws?.close()
    if (decoder && decoder.state !== 'closed') decoder.close()
  }
}
