// A replay buffer: the last stretch of the stream, kept encoded in memory, saved
// as an MP4 on request. The app's own window is captured (the main process hands
// it over, with the system's sound), so it works on every picture path. The
// graphics card encodes; a key frame every two seconds lets the saved clip start
// close to the moment asked for.

import { ArrayBufferTarget, Muxer } from 'mp4-muxer'

const KEY_FRAME_US = 2_000_000
const AUDIO_RATE = 48000

interface Video {
  chunk: EncodedVideoChunk
  key: boolean
}

// Bits per pixel per frame: enough for game footage to stay clean.
const bitrateFor = (width: number, height: number) => Math.min(40e6, Math.max(6e6, width * height * 60 * 0.12))

// H.264 High at a level that fits the size; 5.2 covers 4K at 60.
const avcCodec = (width: number, height: number) => (width * height > 2_228_224 ? 'avc1.640034' : 'avc1.64002A')

export class ReplayBuffer {
  private video: Video[] = []
  private audio: EncodedAudioChunk[] = []
  private videoConfig?: VideoDecoderConfig
  private audioConfig?: AudioDecoderConfig
  private size = { width: 0, height: 0 }
  private lastKey = -Infinity
  private stopped = false
  private videoEncoder?: VideoEncoder
  private audioEncoder?: AudioEncoder

  private constructor(private stream: MediaStream, private keepUs: number) {}

  /** Starts buffering, or undefined where the window cannot be captured or encoded. */
  static async start(seconds: number): Promise<ReplayBuffer | undefined> {
    if (typeof VideoEncoder === 'undefined' || typeof MediaStreamTrackProcessor === 'undefined') return undefined
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: true }).catch(() => undefined)
    if (!stream) return undefined
    const buffer = new ReplayBuffer(stream, seconds * 1e6)
    buffer.run()
    return buffer
  }

  private configureVideo(width: number, height: number) {
    this.size = { width, height }
    // A new size starts a new clip; an MP4 track keeps one size.
    this.video = []
    this.audio = []
    this.videoConfig = undefined
    this.videoEncoder?.close()
    this.videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig) this.videoConfig = meta.decoderConfig
        this.video.push({ chunk, key: chunk.type === 'key' })
        this.prune(chunk.timestamp)
      },
      error: () => this.stop(),
    })
    this.videoEncoder.configure({
      codec: avcCodec(width, height),
      width,
      height,
      bitrate: bitrateFor(width, height),
      framerate: 60,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'realtime',
      avc: { format: 'avc' },
    })
    this.lastKey = -Infinity
  }

  // Keeps the newest key frame that is at least the buffer's length old, and everything after it.
  private prune(newest: number) {
    const cutoff = newest - this.keepUs
    let start = 0
    for (let i = 0; i < this.video.length; i++) {
      if (this.video[i].chunk.timestamp > cutoff) break
      if (this.video[i].key) start = i
    }
    if (start > 0) this.video.splice(0, start)
    const from = this.video[0]?.chunk.timestamp ?? newest
    while (this.audio.length && this.audio[0].timestamp < from) this.audio.shift()
  }

  private run() {
    const [videoTrack] = this.stream.getVideoTracks()
    const [audioTrack] = this.stream.getAudioTracks()

    void (async () => {
      // Chromium takes the track in the constructor; TypeScript only knows the worker form.
      const reader = new MediaStreamTrackProcessor({ track: videoTrack } as MediaStreamTrackProcessorInit).readable.getReader() as ReadableStreamDefaultReader<VideoFrame>
      while (!this.stopped) {
        const { value: frame, done } = await reader.read()
        if (done || !frame) break
        // Even sizes: H.264 works in 2x2 blocks.
        const width = frame.displayWidth & ~1
        const height = frame.displayHeight & ~1
        if (width !== this.size.width || height !== this.size.height) this.configureVideo(width, height)
        const encoder = this.videoEncoder
        // A busy encoder skips frames rather than falling behind.
        if (encoder?.state === 'configured' && encoder.encodeQueueSize < 3) {
          const key = frame.timestamp - this.lastKey >= KEY_FRAME_US
          if (key) this.lastKey = frame.timestamp
          encoder.encode(frame, { keyFrame: key })
        }
        frame.close()
      }
    })()

    if (!audioTrack || typeof AudioEncoder === 'undefined') return
    this.audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig) this.audioConfig = meta.decoderConfig
        this.audio.push(chunk)
      },
      error: () => {
        this.audioEncoder = undefined
      },
    })
    let configured = false
    void (async () => {
      const reader = new MediaStreamTrackProcessor({ track: audioTrack } as MediaStreamTrackProcessorInit).readable.getReader() as ReadableStreamDefaultReader<AudioData>
      while (!this.stopped) {
        const { value: data, done } = await reader.read()
        if (done || !data) break
        const encoder = this.audioEncoder
        if (encoder && !configured) {
          encoder.configure({ codec: 'opus', sampleRate: data.sampleRate || AUDIO_RATE, numberOfChannels: Math.min(2, data.numberOfChannels), bitrate: 160_000 })
          configured = true
        }
        if (encoder?.state === 'configured') encoder.encode(data)
        data.close()
      }
    })()
  }

  /** The buffered stretch as an MP4, or undefined when nothing has been encoded yet. */
  async save(): Promise<ArrayBuffer | undefined> {
    await this.videoEncoder?.flush().catch(() => {})
    const video = this.video.slice()
    const videoConfig = this.videoConfig
    if (!video.length || !videoConfig || !video[0].key) return undefined
    const from = video[0].chunk.timestamp
    const audio = this.audio.filter((a) => a.timestamp >= from)
    const audioConfig = this.audioConfig

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: this.size.width, height: this.size.height, frameRate: 60 },
      audio: audioConfig && audio.length ? { codec: 'opus', numberOfChannels: audioConfig.numberOfChannels, sampleRate: audioConfig.sampleRate } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'cross-track-offset',
    })
    video.forEach((v, i) => muxer.addVideoChunk(v.chunk, i === 0 ? { decoderConfig: videoConfig } : undefined))
    if (audioConfig) audio.forEach((a, i) => muxer.addAudioChunk(a, i === 0 ? { decoderConfig: audioConfig } : undefined))
    muxer.finalize()
    return muxer.target.buffer
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    for (const track of this.stream.getTracks()) track.stop()
    if (this.videoEncoder?.state !== 'closed') this.videoEncoder?.close()
    if (this.audioEncoder?.state !== 'closed') this.audioEncoder?.close()
    this.video = []
    this.audio = []
  }
}
