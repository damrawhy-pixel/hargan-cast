import { useEffect, useRef, useState } from 'react'
import type { PsGame } from '../../../shared/types'
import { StreamShell, type StreamStats } from '../components/StreamShell'
import { getSettings } from '../lib/useSettings'
import { rumble, startInput } from './input'
import type { WorkerCommand, WorkerEvent } from './stream.worker'

const HEVC = { codec: 'hev1.1.6.L153.B0', hardwareAcceleration: 'prefer-hardware' } as const

async function hevcPlayable() {
  try {
    return (await VideoDecoder.isConfigSupported(HEVC)).supported === true
  } catch {
    return false
  }
}

interface Props {
  game: PsGame
  onExit(error?: string): void
}

export function PsStream({ game, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stage, setStage] = useState('Oturum hazırlanıyor')
  const [live, setLive] = useState(false)
  const [stats, setStats] = useState<StreamStats>()
  const [controller, setController] = useState<string>()
  const dualsense = useRef<string>()
  const exiting = useRef(false)

  useEffect(() => {
    const nativeDualSense = () => dualsense.current !== undefined
    let worker: Worker | undefined
    let stopInput: (() => void) | undefined
    let audio: AudioContext | undefined
    let disposed = false

    const leave = (error?: string) => {
      if (exiting.current) return
      exiting.current = true
      onExit(error)
    }

    const offEvents = window.hc.ps.onEvent((e) => {
      if (e.ev === 'progress') setStage(e.stage)
      else if (e.ev === 'connected') setStage('Görüntü bekleniyor')
      else if (e.ev === 'quit') leave(e.error ? e.detail || e.reason : undefined)
      else if (e.ev === 'dualsense') {
        dualsense.current = e.transport
        setController(e.transport === 'usb' ? 'DualSense · USB' : e.transport === 'bluetooth' ? 'DualSense · Bluetooth' : undefined)
      }
    })

    const run = async () => {
      window.hc.platform.streaming(true)
      const settings = getSettings()
      const { psCodec, psVibration } = settings
      const wantsHevc = psCodec === 'h265' || (psCodec === 'auto' && game.streamServiceType === 'pscloud')
      const hevc = wantsHevc && (await hevcPlayable())
      const started = await window.hc.ps.stream(game, { hevc })
      if (disposed) return void window.hc.ps.stop()

      const canvas = canvasRef.current!
      canvas.width = started.width
      canvas.height = started.height
      const offscreen = canvas.transferControlToOffscreen()

      audio = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 })
      await audio.audioWorklet.addModule('./pcm-worklet.js')
      const player = new AudioWorkletNode(audio, 'pcm-player', { outputChannelCount: [2], processorOptions: { targetMs: settings.psAudioBufferMs } })
      const volume = audio.createGain()
      volume.gain.value = settings.audioVolume / 100
      player.connect(volume).connect(audio.destination)
      if (settings.audioOutputDevice) await (audio as any).setSinkId(settings.audioOutputDevice).catch(() => {})
      const channel = new MessageChannel()
      player.port.postMessage(channel.port1, [channel.port1])
      void audio.resume()

      worker = new Worker(new URL('./stream.worker.ts', import.meta.url), { type: 'module' })
      const command = (msg: WorkerCommand, transfer: Transferable[] = []) => worker?.postMessage(msg, transfer)

      worker.onmessage = (e: MessageEvent<WorkerEvent>) => {
        const msg = e.data
        if (msg.type === 'firstFrame') setLive(true)
        else if (msg.type === 'stats') setStats({ fps: msg.fps, mbps: msg.mbps, lost: msg.lost })
        else if (msg.type === 'rumble') psVibration && rumble(msg.left, msg.right, nativeDualSense)
        else if (msg.type === 'ended') leave()
        else if (msg.type === 'error') leave(msg.message)
      }

      command({ type: 'init', url: started.url, canvas: offscreen, codec: started.codec, audio: channel.port2, decoder: settings.videoDecoder }, [offscreen, channel.port2])
      stopInput = startInput((report) => command({ type: 'input', report }, [report]), nativeDualSense, {
        deadZone: settings.psDeadZone / 100,
        keyboard: settings.psKeyboard,
        buttonsByPosition: settings.psButtonsByPosition,
      })
    }

    run().catch((e: Error) => leave(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))

    return () => {
      disposed = true
      offEvents()
      stopInput?.()
      worker?.postMessage({ type: 'close' } satisfies WorkerCommand)
      setTimeout(() => worker?.terminate(), 200)
      void audio?.close()
      void window.hc.ps.stop()
      window.hc.platform.streaming(false)
    }
    // A stream lives exactly as long as this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <StreamShell title={game.name} stage={stage} live={live} stats={stats} controller={controller} image={game.imageUrl || game.landscapeImageUrl} onExit={() => onExit()}>
      <canvas ref={canvasRef} className="stream-surface" />
    </StreamShell>
  )
}
