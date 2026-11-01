import { useEffect, useRef, useState } from 'react'
import type { XboxTitle } from '../../../shared/types'
import { StreamShell } from '../components/StreamShell'
import { getSettings } from '../lib/useSettings'

const HOLDER_ID = 'xbox-video-holder'
const POLL_MS = 1000
const KEEPALIVE_MS = 30_000
const RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAY_MS = 1500
const H264_PROFILES = { high: '4d', main: '42e', baseline: '420' }

interface Props {
  title: XboxTitle
  /** Join this running session instead of starting a new one. */
  resumeId?: string
  onExit(error?: string): void
}

export function XboxStream({ title, resumeId, onExit }: Props) {
  const [stage, setStage] = useState(resumeId ? 'Oturuma dönülüyor' : 'Sunucu ayrılıyor')
  const [live, setLive] = useState(false)
  const exiting = useRef(false)

  useEffect(() => {
    const xbox = window.hc.xbox
    let sessionId = resumeId ?? ''
    let disposed = false
    let player: any
    let attempts = 0
    let poll: ReturnType<typeof setInterval> | undefined
    let keepalive: ReturnType<typeof setInterval> | undefined

    const leave = (error?: string) => {
      if (exiting.current) return
      exiting.current = true
      onExit(error)
    }

    // The session outlives the connection, so a dropped link can be negotiated again.
    const reconnect = () => {
      if (disposed) return
      clearInterval(keepalive)
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
      if (settings.xboxAudioBitrate > 0) player.setAudioBitrate(settings.xboxAudioBitrate)
      player.setAudioControl(settings.audioVolume !== 100)
      if (settings.xboxAudioRumble) player.setAudioRumble(true, settings.xboxAudioRumbleThreshold)
      player.setFsrSharpness(settings.xboxFsrSharpness)
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
        if (settings.xboxFsr) player.startFSR(() => {})
        applyAudio()
        keepalive = setInterval(() => void xbox.keepalive(sessionId), KEEPALIVE_MS)
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
        if (session.playerState === 'queued' && session.waitingSeconds)
          setStage(`Sırada, yaklaşık ${Math.ceil(session.waitingSeconds / 60)} dk`)
        else if (session.playerState === 'failed') {
          clearInterval(poll)
          leave(session.error ?? 'Oturum başlatılamadı')
        } else if (session.playerState === 'started') {
          clearInterval(poll)
          negotiate().catch((e: Error) => leave(e.message))
        }
      }, POLL_MS)
    }

    window.hc.platform.streaming(true)
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
      player?.close()
      if (sessionId) void xbox.stopStream(sessionId)
      window.hc.platform.streaming(false)
    }
    // A stream lives exactly as long as this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <StreamShell title={title.name} stage={stage} live={live} image={title.poster ?? title.image} onExit={() => onExit()}>
      <div id={HOLDER_ID} className="stream-surface" />
    </StreamShell>
  )
}
