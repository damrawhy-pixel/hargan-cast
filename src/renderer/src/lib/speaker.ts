import { getSettings } from './useSettings'

const TONE_HZ = 660
const TONE_SECONDS = 0.8
const TONE_LEVEL = 0.4

const outputs = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput')

// The controller keeps sound on its headset jack until told otherwise, and forgets
// the choice when it powers off, so this runs at the start of every stream.
export async function routeDualSenseSpeaker() {
  const { audioOutputDevice, dualSenseSpeaker } = getSettings()
  if (!dualSenseSpeaker) return
  const id = audioOutputDevice || 'default'
  const device = (await outputs()).find((d) => d.deviceId === id)
  if (device?.label.includes('DualSense')) await window.hc.ps.routeSpeaker()
}

export async function testDualSenseSpeaker() {
  const device = (await outputs()).find((d) => d.deviceId !== 'default' && d.deviceId !== 'communications' && d.label.includes('DualSense'))
  if (!device || !(await window.hc.ps.routeSpeaker())) return false

  const audio = new AudioContext()
  await (audio as any).setSinkId(device.deviceId)
  const tone = audio.createOscillator()
  const volume = audio.createGain()
  tone.frequency.value = TONE_HZ
  volume.gain.value = TONE_LEVEL
  tone.connect(volume).connect(audio.destination)
  tone.start()
  await new Promise<void>((done) => {
    tone.onended = () => done()
    tone.stop(audio.currentTime + TONE_SECONDS)
  })
  await audio.close()
  return true
}
