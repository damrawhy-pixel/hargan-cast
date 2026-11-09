import { getSettings } from './useSettings'

// Short synthesised cues in the manner of a console menu. Nothing is loaded from
// disk, and the context only wakes when a sound actually plays.

let context: AudioContext | undefined
let last = 0
const MIN_GAP_MS = 35

// A menu sound must never take the interface down with it: where Web Audio is
// missing or refuses to start, the cues are simply silent.
function play(notes: [frequency: number, at: number, length: number][], level: number) {
  try {
    cue(notes, level)
  } catch {
    // Silent.
  }
}

function cue(notes: [frequency: number, at: number, length: number][], level: number) {
  if (!getSettings().uiSounds || typeof AudioContext === 'undefined') return
  const now = performance.now()
  if (now - last < MIN_GAP_MS) return
  last = now
  context ??= new AudioContext({ latencyHint: 'interactive' })
  const audio = context
  const start = audio.currentTime + 0.005
  for (const [frequency, at, length] of notes) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(0, start + at)
    gain.gain.linearRampToValueAtTime(level, start + at + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + at + length)
    osc.connect(gain).connect(audio.destination)
    osc.start(start + at)
    osc.stop(start + at + length + 0.02)
  }
}

export const sounds = {
  move: () => play([[1760, 0, 0.045]], 0.035),
  select: () => play([[880, 0, 0.06], [1320, 0.045, 0.09]], 0.05),
  back: () => play([[990, 0, 0.06], [660, 0.045, 0.09]], 0.045),
  tab: () => play([[1320, 0, 0.05], [1568, 0.03, 0.06]], 0.035),
  // A rising C major arpeggio for the start-up screen.
  startup: () => play([[523.25, 0, 0.9], [659.25, 0.11, 0.9], [783.99, 0.22, 1], [1046.5, 0.36, 1.5]], 0.045),
}
