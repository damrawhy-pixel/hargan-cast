import { useEffect, useRef, useState } from 'react'
import type { XboxTitle } from '../../../shared/types'
import { StreamShell, type StreamQueue, type StreamStats } from '../components/StreamShell'
import { Picture, fitFor, outputSize, pictureLabel, type Fit, type PictureOptions, type Size } from '../lib/picture'
import { routeDualSenseSpeaker } from '../lib/speaker'
import { getSettings } from '../lib/useSettings'

const HOLDER_ID = 'xbox-video-holder'
const POLL_MS = 1000
const KEEPALIVE_MS = 30_000
const STATS_MS = 1000
const RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAY_MS = 1500
const H264_PROFILES = { high: '4d', main: '42e', baseline: '420' }

// Paints each new video frame, post-processed, onto a canvas laid over the video.
function startPicture(video: HTMLVideoElement, options: PictureOptions, fit: Fit) {
  const canvas = document.createElement('canvas')
  canvas.className = 'stream-fsr'
  video.after(canvas)
  const picture = Picture.create(canvas, options)
  if (!picture) {
    canvas.remove()
    return undefined
  }

  let box: Size = { width: 0, height: 0 }
  const observer = new ResizeObserver(([entry]) => {
    const size = entry.devicePixelContentBoxSize?.[0]
    if (size) box = { width: size.inlineSize, height: size.blockSize }
  })
  observer.observe(canvas, { box: 'device-pixel-content-box' })

  let handle = 0
  const paint = () => {
    const frame = { width: video.videoWidth, height: video.videoHeight }
    if (frame.width && box.width && box.height) {
      const out = outputSize(box, frame, fit)
      if (canvas.width !== out.width || canvas.height !== out.height) {
        canvas.width = out.width
        canvas.height = out.height
      }
      picture.draw(video, frame.width, frame.height)
    }
    handle = video.requestVideoFrameCallback(paint)
  }
  handle = video.requestVideoFrameCallback(paint)

  return () => {
    video.cancelVideoFrameCallback(handle)
    observer.disconnect()
    picture.dispose()
    canvas.remove()
  }
}

interface Props {
  title: XboxTitle
  /** Join this running session instead of starting a new one. */
  resumeId?: string
  onExit(error?: string): void
}

export function XboxStream({ title, resumeId, onExit }: Props) {
  const [stage, setStage] = useState(resumeId ? 'Oturuma dönülüyor' : 'Sunucu ayrılıyor')
  const [live, setLive] = useState(false)
  const [stats, setStats] = useState<StreamStats>()
  const [queue, setQueue] = useState<StreamQueue>()
  const exiting = useRef(false)

  useEffect(() => {
    const xbox = window.hc.xbox
    let sessionId = resumeId ?? ''
    let disposed = false
    let player: any
    let attempts = 0
    let poll: ReturnType<typeof setInterval> | undefined
    let keepalive: ReturnType<typeof setInterval> | undefined
    let meter: ReturnType<typeof setInterval> | undefined
    let stopPicture: (() => void) | undefined
    let filters = ''

    const leave = (error?: string) => {
      if (exiting.current) return
      exiting.current = true
      onExit(error)
    }

    // The session outlives the connection, so a dropped link can be negotiated again.
    const reconnect = () => {
      if (disposed) return
      clearInterval(keepalive)
      clearInterval(meter)
      stopPicture?.()
      if (attempts >= RECONNECT_ATTEMPTS) return leave('Bağlantı koptu ve yeniden kurulamadı')
      attempts++
      setLive(false)
      setStage(`Bağlantı koptu, yeniden bağlanılıyor (${attempts}/${RECONNECT_ATTEMPTS})`)
      player?.close()
      player = undefined
      document.getElementById(HOLDER_ID)?.replaceChildren()
      setTimeout(() => {
        if (!disposed) negotiate().catch(reconnect)
      }, RECONNECT_DELAY_MS)
    }

    const applyAudio = () => {
      const { audioOutputDevice, audioVolume } = getSettings()
      const gain = player._audio_gain_node
      if (gain) gain.gain.value = audioVolume / 100
      // With a gain node the sound leaves through its context, not the element.
      const output = gain?.context ?? document.querySelector(`#${HOLDER_ID} audio`)
      if (audioOutputDevice) void output?.setSinkId?.(audioOutputDevice)?.catch?.(() => {})
    }

    const measure = async (video: HTMLVideoElement | null) => {
      const state = await player?.getStreamState()
      if (!state || disposed) return
      setStats({
        fps: state.fps,
        mbps: parseFloat(state.br) || 0,
        lost: parseInt(state.pl) || 0,
        rttMs: state.rtt.startsWith('-') ? undefined : Math.round(parseFloat(state.rtt)) || undefined,
        decodeMs: parseFloat(state.decode) || undefined,
        size: video?.videoWidth ? [`${video.videoWidth}×${video.videoHeight}`, filters].filter(Boolean).join(' · ') : undefined,
      })
    }

    const negotiate = async () => {
      // The player pulls in three.js; load it only when a stream actually starts.
      const { default: StreamPlayer } = await import('xstreaming-player')
      if (disposed) return

      const settings = getSettings()
      player = new StreamPlayer(HOLDER_ID, {
        input_touch: false,
        ui_touchenabled: false,
        input_mousekeyboard: settings.xboxMouseKeyboard,
        input_legacykeyboard: true,
      } as any)
      player.bind(
        settings.xboxTurnUrl
          ? { turnServer: { url: settings.xboxTurnUrl, username: settings.xboxTurnUsername, credential: settings.xboxTurnCredential } }
          : undefined,
      )
      player.setVideoFormat(settings.videoFormat)
      if (settings.xboxCodec) player.setCodecPreferences('video/H264', { profiles: [H264_PROFILES[settings.xboxCodec]] })
      if (settings.xboxBitrate > 0) player.setVideoBitrate(settings.xboxBitrate)
      player.setAudioControl(settings.audioVolume !== 100)
      if (settings.xboxAudioRumble) player.setAudioRumble(true, settings.xboxAudioRumbleThreshold)
      player.setGamepadIndex(settings.xboxGamepadIndex)
      player.setGamepadMix(settings.xboxGamepadMix)
      player.setPollRate(settings.xboxPollingRate)
      player.setCoOpMode(settings.xboxCoop)
      player.setMouseSensitive(settings.xboxMouseSensitivity)
      player.setForceTriggerRumble(settings.xboxTriggerRumble)
      player.setSwapTriggerRumble(settings.xboxSwapTriggerRumble)
      player.setGamepadKernal('Web')
      player.setVibration(settings.xboxVibration)
      player.setVibrationMode('Webview')
      player.setGamepadDeadZone(settings.xboxDeadZone / 100)
      player.setConnectFailHandler(reconnect)
      player.setSdpHandler((_client: unknown, offer: RTCSessionDescriptionInit) => {
        xbox.sendChatSdp(sessionId, offer.sdp!).then((r) => player.setRemoteOffer(r.sdp))
      })
      player.getEventBus().on('connectionstate', (event: { state: string }) => {
        if (event.state !== 'connected') return
        attempts = 0
        // The picture starts a few seconds after the connection; keep the veil until then.
        setStage('Görüntü bekleniyor')
        const video = document.querySelector<HTMLVideoElement>(`#${HOLDER_ID} video`)
        if (video && !video.videoWidth) video.addEventListener('loadeddata', () => setLive(true), { once: true })
        else setLive(true)
        stopPicture?.()
        const options: PictureOptions = { fsr: settings.xboxFsr, sharpness: settings.xboxFsrSharpness, deband: settings.xboxDeband }
        stopPicture = (options.fsr || options.deband) && video ? startPicture(video, options, fitFor(settings.videoFormat)) : undefined
        filters = stopPicture ? pictureLabel(options) : ''
        applyAudio()
        keepalive = setInterval(() => void xbox.keepalive(sessionId), KEEPALIVE_MS)
        clearInterval(meter)
        meter = setInterval(() => void measure(video), STATS_MS)
      })

      setStage((current) => (attempts > 0 ? current : 'Bağlantı kuruluyor'))
      const offer = await player.createOffer()
      const answer = await xbox.sendSdp(sessionId, offer.sdp)
      player.setRemoteOffer(answer.sdp)

      const candidates = Object.values<RTCIceCandidateInit>(player.getIceCandidates()).map((c) => ({
        candidate: c.candidate,
        sdpMLineIndex: c.sdpMLineIndex,
        sdpMid: c.sdpMid,
      }))
      player.setIceCandidates(await xbox.sendIce(sessionId, candidates))
    }

    const watch = () => {
      poll = setInterval(async () => {
        const session = await xbox.session(sessionId)
        if (!session) return leave('Oturum sunucuda sonlandı')
        if (session.playerState === 'failed') {
          clearInterval(poll)
          leave(session.error ?? 'Oturum başlatılamadı')
        } else if (session.playerState === 'started') {
          clearInterval(poll)
          setQueue(undefined)
          negotiate().catch((e: Error) => leave(e.message))
        } else if (session.state === 'WaitingForResources') {
          // Once set, the estimate stays put and the card counts it down.
          setQueue((queue) => (queue?.seconds !== undefined ? queue : { seconds: session.waitingSeconds }))
        } else setQueue(undefined)
      }, POLL_MS)
    }

    window.hc.platform.streaming(true)
    void routeDualSenseSpeaker().catch(() => {})
    if (resumeId) {
      xbox.adoptSession(resumeId, title.titleId).then(() => negotiate()).catch(() => leave('Oturuma dönülemedi, oyunu yeniden başlat'))
    } else {
      xbox
        .startStream(title.titleId)
        .then((id) => {
          sessionId = id
          if (disposed) void xbox.stopStream(id)
          else watch()
        })
        .catch((e: Error) => leave(e.message))
    }

    return () => {
      disposed = true
      clearInterval(poll)
      clearInterval(keepalive)
      clearInterval(meter)
      stopPicture?.()
      player?.close()
      if (sessionId) void xbox.stopStream(sessionId)
      window.hc.platform.streaming(false)
    }
    // A stream lives exactly as long as this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <StreamShell title={title.name} stage={stage} live={live} stats={stats} queue={queue} image={title.poster ?? title.image} onExit={() => onExit()}>
      <div id={HOLDER_ID} className="stream-surface" />
    </StreamShell>
  )
}
