import { useEffect, useRef, useState } from 'react'
import type { PsConsole, PsGame } from '../../../shared/types'
import { StreamShell, type StreamQueue, type StreamStats } from '../components/StreamShell'
import { fitFor, pictureActive, pictureLabel, pictureOptionsFor } from '../lib/picture'
import { startVideoSurface, videoSurfaceSupported } from '../lib/videoSurface'
import { MOBILE } from '../lib/platform'
import { routeDualSenseSpeaker } from '../lib/speaker'
import { getSettings } from '../lib/useSettings'
import { settingsFor } from '../../../shared/settings'
import { t } from '../../../shared/i18n'
import { rumble, startInput } from './input'
import { psQuit, psStage, reconnectable } from './stages'
import type { View, WorkerCommand, WorkerEvent } from './stream.worker'

const HEVC = { codec: 'hev1.1.6.L153.B0', hardwareAcceleration: 'prefer-hardware' } as const
// HEVC Main 10, the profile HDR comes in.
const HEVC_10 = { codec: 'hev1.2.4.L153.B0', hardwareAcceleration: 'prefer-hardware' } as const

// A stream that drops after it was playing is started again, with longer waits
// between tries; a fourth drop in a row ends it.
const RECONNECT_DELAYS_MS = [2000, 5000, 10000]
// The worker's words for the core going away under it, which a new session can fix.
const MEDIA_LOST = 'PlayStation bağlantısı beklenmedik şekilde kesildi'

async function playable(config: VideoDecoderConfig) {
  try {
    return (await VideoDecoder.isConfigSupported(config)).supported === true
  } catch {
    return false
  }
}

/** The screen is in HDR mode right now (Windows' "Use HDR" switch). */
const hdrScreen = () => matchMedia('(dynamic-range: high)').matches

const online = () =>
  navigator.onLine
    ? Promise.resolve()
    : new Promise<void>((resolve) => window.addEventListener('online', () => resolve(), { once: true }))

interface Props {
  /** A cloud game, or else `console`: Remote Play from the user's own console. */
  game?: PsGame
  console?: PsConsole
  onExit(error?: string): void
}

export function PsStream({ game, console: target, onExit }: Props) {
  const key = target ? `console:${target.id}` : `ps:${game!.productId}`
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  // Chosen once: the surface element cannot change during a stream.
  // HDR reaches the screen only on the graphics card's video path, so it takes that path.
  const [system] = useState(() => {
    const s = settingsFor(getSettings(), key)
    return videoSurfaceSupported && (s.upscaler === 'system' || Boolean(target?.ps5 && s.psHdr && hdrScreen()))
  })
  // A canvas hands itself to a worker only once, so each new session gets a new one.
  const [surfaceKey, setSurfaceKey] = useState(0)
  const [stage, setStage] = useState(() => t('Oturum hazırlanıyor'))
  const [live, setLive] = useState(false)
  const [stats, setStats] = useState<StreamStats>()
  const [queue, setQueue] = useState<StreamQueue>()
  const [controller, setController] = useState<string>()
  const dualsense = useRef<string>()
  const exiting = useRef(false)

  useEffect(() => {
    const nativeDualSense = () => dualsense.current !== undefined
    let worker: Worker | undefined
    let stopInput: (() => void) | undefined
    let audio: AudioContext | undefined
    let resizer: ResizeObserver | undefined
    let surface: ReturnType<typeof startVideoSurface> | undefined
    let disposed = false
    let wasLive = false
    let attempts = 0
    let reconnecting = false

    const leave = (error?: string) => {
      if (exiting.current) return
      exiting.current = true
      onExit(error)
    }

    // Everything one session owns; the stream itself (power, the core) outlives it.
    const teardown = () => {
      resizer?.disconnect()
      stopInput?.()
      const old = worker
      old?.postMessage({ type: 'close' } satisfies WorkerCommand)
      setTimeout(() => old?.terminate(), 200)
      surface?.dispose()
      void audio?.close()
      worker = stopInput = audio = resizer = surface = undefined
    }

    const reconnect = (why: string) => {
      if (disposed || reconnecting) return
      if (!wasLive || attempts >= RECONNECT_DELAYS_MS.length) return leave(why)
      reconnecting = true
      const delay = RECONNECT_DELAYS_MS[attempts++]
      teardown()
      setLive(false)
      setStats(undefined)
      setStage(t('Bağlantı koptu, yeniden bağlanılıyor ({n}/{max})', { n: attempts, max: RECONNECT_DELAYS_MS.length }))
      if (!system) setSurfaceKey((k) => k + 1)
      setTimeout(() => {
        void online().then(() => {
          if (disposed) return
          reconnecting = false
          run().catch(failed)
        })
      }, delay)
    }

    const failed = (e: Error) => {
      const message = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      // A try that fails while reconnecting (the network still down) counts as one.
      if (wasLive) reconnect(message)
      else leave(message)
    }

    const offEvents = window.hc.ps.onEvent((e) => {
      if (reconnecting) return
      if (e.ev === 'progress') {
        const { text, position } = psStage(e.stage)
        setStage(text)
        setQueue(position === undefined ? undefined : { position })
      } else if (e.ev === 'connected') {
        setStage(t('Görüntü bekleniyor'))
        setQueue(undefined)
      } else if (e.ev === 'quit') {
        if (!e.error) leave()
        else if (reconnectable(e.reason)) reconnect(psQuit(e.reason))
        else leave(psQuit(e.reason))
      } else if (e.ev === 'dualsense') {
        dualsense.current = e.transport
        setController(e.transport === 'usb' ? 'DualSense · USB' : e.transport === 'bluetooth' ? 'DualSense · Bluetooth' : undefined)
      }
    })

    const run = async () => {
      window.hc.platform.streaming(true)
      void routeDualSenseSpeaker().catch(() => {})
      const settings = settingsFor(getSettings(), key)
      const { psCodec, psVibration } = settings
      const wantsHevc = psCodec === 'h265' || (psCodec === 'auto' && (target ? target.ps5 : game!.streamServiceType === 'pscloud'))
      const hevc = wantsHevc && (await playable(HEVC))
      const hdr = Boolean(target?.ps5) && system && hevc && settings.psHdr && hdrScreen() && (await playable(HEVC_10))
      const started = target ? await window.hc.ps.consoles!.stream(target.id, { hevc, hdr }) : await window.hc.ps.stream(game!, { hevc })
      if (disposed) return void window.hc.ps.stop()

      const element: HTMLElement = system ? videoRef.current! : canvasRef.current!
      const fit = fitFor(settings.videoFormat)
      const box = element.getBoundingClientRect()
      const view: View = { width: Math.round(box.width * devicePixelRatio), height: Math.round(box.height * devicePixelRatio), fit }
      // The app's shaders run only on its own canvas; on the video path the graphics card scales.
      const options = pictureOptionsFor(settings, 'ps')
      const picture = !system && pictureActive(options) ? options : undefined
      const offscreen = system ? undefined : canvasRef.current!.transferControlToOffscreen()
      if (system) surface = startVideoSurface(videoRef.current!, settings.framePacing)

      audio = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 })
      await audio.audioWorklet.addModule('./pcm-worklet.js')
      const player = new AudioWorkletNode(audio, 'pcm-player', { outputChannelCount: [2], processorOptions: { targetMs: settings.psAudioBufferMs } })
      const volume = audio.createGain()
      volume.gain.value = settings.audioVolume / 100
      player.connect(volume).connect(audio.destination)
      if (settings.audioOutputDevice) await (audio as any).setSinkId?.(settings.audioOutputDevice)?.catch?.(() => {})
      const channel = new MessageChannel()
      player.port.postMessage(channel.port1, [channel.port1])
      void audio.resume()

      const own = new Worker(new URL('./stream.worker.ts', import.meta.url), { type: 'module' })
      worker = own
      const command = (msg: WorkerCommand, transfer: Transferable[] = []) => own.postMessage(msg, transfer)

      own.onmessage = (e: MessageEvent<WorkerEvent>) => {
        const msg = e.data
        // A worker being closed for a reconnect may still talk; only the current one counts.
        if (worker !== own) {
          if (msg.type === 'frame') msg.frame.close()
          return
        }
        if (msg.type === 'frame') surface ? surface.push(msg.frame) : msg.frame.close()
        else if (msg.type === 'firstFrame') {
          setLive(true)
          wasLive = true
          attempts = 0
        } else if (msg.type === 'stats') {
          const scaling = system ? t('ekran kartı büyütmesi') : msg.filters && picture ? pictureLabel(picture) : ''
          setStats({ fps: msg.fps, mbps: msg.mbps, lost: msg.lost, rttMs: started.rttMs, decodeMs: msg.decodeMs, waitMs: msg.waitMs, jitterMs: msg.jitterMs, skipped: msg.skipped + (surface?.dropped() ?? 0), size: scaling ? `${msg.size} · ${scaling}` : msg.size })
        }
        // On phones the app rumbles the paired controller itself, straight from the session.
        else if (msg.type === 'rumble') psVibration && !MOBILE && rumble(msg.left, msg.right, nativeDualSense)
        else if (msg.type === 'ended') {
          if (!reconnecting) leave()
        } else if (msg.type === 'error') {
          if (msg.message === MEDIA_LOST) reconnect(t(msg.message))
          else leave(t(msg.message))
        }
      }

      command(
        { type: 'init', url: started.url, canvas: offscreen, pacing: settings.framePacing, codec: started.codec, audio: channel.port2, decoder: settings.videoDecoder, view, picture },
        offscreen ? [offscreen, channel.port2] : [channel.port2],
      )
      resizer = new ResizeObserver(([entry]) => {
        // Safari reports CSS pixels only; scale those to the screen's own.
        const exact = entry.devicePixelContentBoxSize?.[0]
        const css = entry.contentBoxSize?.[0]
        const size = exact ?? (css && { inlineSize: Math.round(css.inlineSize * devicePixelRatio), blockSize: Math.round(css.blockSize * devicePixelRatio) })
        if (size) command({ type: 'view', view: { width: size.inlineSize, height: size.blockSize, fit } })
      })
      try {
        resizer.observe(element, { box: 'device-pixel-content-box' })
      } catch {
        resizer.observe(element)
      }
      stopInput = startInput((report) => command({ type: 'input', report }, [report]), nativeDualSense, {
        deadZone: settings.psDeadZone / 100,
        keyboard: settings.psKeyboard,
        buttonsByPosition: settings.psButtonsByPosition,
      })
    }

    run().catch(failed)

    return () => {
      disposed = true
      offEvents()
      teardown()
      void window.hc.ps.stop()
      window.hc.platform.streaming(false)
    }
    // A stream lives exactly as long as this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <StreamShell platform="playstation" profileKey={key} title={target ? target.name : game!.name} stage={stage} live={live} stats={stats} queue={queue} controller={controller} image={target ? undefined : game!.imageUrl || game!.landscapeImageUrl} onExit={() => onExit()}>
      {system ? <video ref={videoRef} className="stream-surface" muted playsInline /> : <canvas key={surfaceKey} ref={canvasRef} className="stream-surface" />}
    </StreamShell>
  )
}
