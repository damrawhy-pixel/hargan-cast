// The player's microphone for Remote Play: 10 ms frames of 48 kHz mono, 16-bit,
// each sent with a type byte (3) the core reads as microphone audio
// (native/ps-core/src/microphone.h). The context runs at 48 kHz, so samples
// arrive at the right rate already.
const FRAME = 480
const MIC_REPORT = 3

class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.frame = new Int16Array(FRAME)
    this.filled = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    for (let i = 0; i < channel.length; i++) {
      const v = Math.max(-1, Math.min(1, channel[i]))
      this.frame[this.filled++] = v < 0 ? v * 0x8000 : v * 0x7fff
      if (this.filled === FRAME) {
        const out = new Uint8Array(1 + FRAME * 2)
        out[0] = MIC_REPORT
        out.set(new Uint8Array(this.frame.buffer), 1)
        this.port.postMessage(out.buffer, [out.buffer])
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('mic-capture', MicCapture)
