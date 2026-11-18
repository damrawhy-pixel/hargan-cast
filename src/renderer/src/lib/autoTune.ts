// Settings that fit this computer: measured, not guessed. The screen's refresh
// rate, size and HDR state, what the graphics card decodes, who made it, and
// (on the desktop) the connection's speed and kind decide picture and stream
// settings; each change comes with the reason, so the user can see why.
import type { AppSettings } from '../../../shared/settings'
import { t } from '../../../shared/i18n'
import { suggestedPsBitrate } from './bitrate'
import { videoSurfaceSupported } from './videoSurface'
import { MOBILE } from './platform'

export interface Machine {
  refreshHz: number
  /** The screen's height in device pixels. */
  screenHeight: number
  hdr: boolean
  hevc: boolean
  hevc10: boolean
  /** WebGL's renderer string, e.g. "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 ...)". */
  gpu: string
  downloadMbps?: number
  wifi?: boolean
}

export interface Tuning {
  changes: Partial<AppSettings>
  reasons: string[]
}

async function measureRefresh(): Promise<number> {
  const times: number[] = []
  await new Promise<void>((resolve) => {
    const tick = (now: number) => {
      times.push(now)
      if (times.length < 40) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame(tick)
  })
  const gaps = times.slice(1).map((v, i) => v - times[i]).sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)] || 1000 / 60
  return Math.round(1000 / median)
}

const decodes = async (codec: string) => {
  try {
    return (await VideoDecoder.isConfigSupported({ codec, hardwareAcceleration: 'prefer-hardware' })).supported === true
  } catch {
    return false
  }
}

function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    const name = info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return name
  } catch {
    return ''
  }
}

export async function measureMachine(withNetwork: boolean): Promise<Machine> {
  const [refreshHz, hevc, hevc10] = await Promise.all([measureRefresh(), decodes('hev1.1.6.L153.B0'), decodes('hev1.2.4.L153.B0')])
  const network = withNetwork ? await window.hc.platform.networkTest?.().catch(() => undefined) : undefined
  return {
    refreshHz,
    screenHeight: Math.round(screen.height * devicePixelRatio),
    hdr: matchMedia('(dynamic-range: high)').matches,
    hevc,
    hevc10,
    gpu: gpuName(),
    downloadMbps: network?.downloadMbps,
    wifi: network?.adapter ? network.adapter.kind === 'wifi' : undefined,
  }
}

const fitsSixty = (hz: number) => Math.abs(hz / 60 - Math.round(hz / 60)) < 0.03

/** What to change for this machine; pure, so it can be tested. */
export function tune(m: Machine, desktop = !MOBILE): Tuning {
  const changes: Partial<AppSettings> = {}
  const reasons: string[] = []

  // NVIDIA's RTX Video works on the graphics card's video path; elsewhere the app's FSR is the better scaler.
  const nvidiaRtx = /nvidia/i.test(m.gpu) && /rtx/i.test(m.gpu)
  if (nvidiaRtx && videoSurfaceSupported) {
    changes.upscaler = 'system'
    reasons.push(t('NVIDIA RTX ekran kartı: büyütmeyi ekran kartı yapacak (sürücüde RTX Video açıksa devreye girer).'))
  } else {
    changes.upscaler = 'shader'
    changes.psFsr = true
    changes.xboxFsr = m.screenHeight > 1080
    reasons.push(m.screenHeight > 1080 ? t('Ekran 1080p’den büyük: görüntüyü FSR ile büyütüp keskinleştirecek.') : t('Görüntüyü uygulama işleyecek (FSR).'))
  }

  if (desktop && m.refreshHz > 61 && !fitsSixty(m.refreshHz)) {
    changes.matchRefreshRate = true
    reasons.push(t('Ekran {hz} Hz: akış sırasında 60’ın katına geçecek, kareler eşit sürede görünecek.', { hz: m.refreshHz }))
  }

  if (m.wifi) {
    changes.framePacing = 'smooth'
    reasons.push(t('Wi-Fi bağlantısı: kareler ekranın yenilenmesine hizalanacak, dalgalanma takılma olarak görünmeyecek.'))
  } else if (m.wifi === false) {
    changes.framePacing = 'latency'
    reasons.push(t('Kablolu bağlantı: en düşük gecikme seçildi.'))
  }

  changes.psCodec = m.hevc ? 'auto' : 'h264'
  if (!m.hevc) reasons.push(t('Ekran kartı HEVC çözemiyor: PlayStation H.264 kullanacak.'))
  changes.psHdr = m.hdr && m.hevc10
  if (m.hdr && m.hevc10) reasons.push(t('Ekran HDR modunda ve ekran kartı 10 bit HEVC çözüyor: PS5’ten HDR istenecek.'))

  if (m.downloadMbps !== undefined) {
    const bitrate = suggestedPsBitrate(m.downloadMbps)
    // 4K wants about 40 Mb/s, 1440p about 30; only when both the screen and the line carry it.
    const resolution = m.screenHeight >= 2160 && bitrate >= 40000 ? 2160 : m.screenHeight >= 1440 && bitrate >= 30000 ? 1440 : 1080
    if (bitrate) {
      changes.psCloudBitrate = bitrate
      changes.psNowBitrate = bitrate
    }
    changes.psCloudResolution = resolution
    changes.psRemoteResolution = resolution
    changes.xboxResolution = m.downloadMbps >= 25 ? 1081 : 1080
    reasons.push(
      bitrate
        ? t('İndirme {mbps} Mb/sn: PlayStation {res}p ve {rate} Mb/sn ile akacak.', { mbps: m.downloadMbps, res: resolution, rate: bitrate / 1000 })
        : t('İndirme {mbps} Mb/sn: akış için düşük, takılma olabilir.', { mbps: m.downloadMbps }),
    )
    if (m.downloadMbps >= 25) reasons.push(t('Xbox en yüksek kalitede açılacak.'))
  }
  return { changes, reasons }
}
