// Plays interleaved s16 PCM chunks with the smallest buffer that survives jitter.
const MAX_FACTOR = 3

class PcmPlayer extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.targetMs = options.processorOptions?.targetMs ?? 30
    this.channels = 2
    this.chunks = []
    this.offset = 0
    this.buffered = 0
    this.started = false
    this.port.onmessage = (e) => {
      // First message hands over the port the stream worker writes to.
      e.data.onmessage = (m) => this.receive(m.data)
    }
  }

  receive(msg) {
    if (msg.channels) {
      this.channels = msg.channels
      return
    }
    const pcm = new Int16Array(msg)
    this.chunks.push(pcm)
    this.buffered += pcm.length / this.channels

    // Behind the stream: drop the oldest audio rather than keep the delay.
    const max = (sampleRate * this.targetMs * MAX_FACTOR) / 1000
    while (this.buffered > max && this.chunks.length > 1) {
      const old = this.chunks.shift()
      this.buffered -= (old.length - this.offset) / this.channels
      this.offset = 0
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0]
    const frames = out[0].length

    if (!this.started) {
      if (this.buffered < (sampleRate * this.targetMs) / 1000) return true
      this.started = true
    }

    for (let i = 0; i < frames; i++) {
      const chunk = this.chunks[0]
      if (!chunk) {
        this.started = false // underrun: rebuild the cushion
        break
      }
      for (let c = 0; c < out.length; c++) {
        out[c][i] = chunk[this.offset + Math.min(c, this.channels - 1)] / 32768
      }
      this.offset += this.channels
      this.buffered--
      if (this.offset >= chunk.length) {
        this.chunks.shift()
        this.offset = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-player', PcmPlayer)
