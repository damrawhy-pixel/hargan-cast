import type { LanguageSetting, Message } from './i18n'

export type VideoFormat = '' | 'Stretch' | 'Zoom' | '16:10' | '18:9' | '21:9' | '4:3'

export interface AppSettings {
  // General
  /** Interface language; '' follows the system. */
  language: LanguageSetting
  startFullscreen: boolean
  fullscreenOnStream: boolean
  doubleClickFullscreen: boolean
  hideCursor: boolean
  showGameImage: boolean
  backgroundKeepalive: boolean
  useVulkan: boolean
  /** Forces GPU features on drivers Chromium distrusts; off by default since it can crash them. */
  ignoreGpuBlocklist: boolean
  fontSize: number
  uiSounds: boolean
  /** 'system' follows Windows' "Animation effects" switch. */
  motion: 'on' | 'system' | 'off'

  // Stats
  showStats: boolean
  statsVertical: boolean

  // On-screen controls, phones and tablets only. 'auto' hides them once a controller is used.
  touchControls: 'auto' | 'on' | 'off'
  touchOpacity: number
  touchSize: number
  touchVibrate: boolean

  // Picture, shared by both services
  videoFormat: VideoFormat
  brightness: number
  contrast: number
  saturation: number
  videoDecoder: 'prefer-hardware' | 'prefer-software' | 'no-preference'

  // Sound, shared by both services
  audioOutputDevice: string
  audioVolume: number

  // PlayStation
  psCloudResolution: number
  psCloudBitrate: number
  psCloudDatacenter: string
  psNowResolution: number
  psNowBitrate: number
  psNowDatacenter: string
  psCodec: 'auto' | 'h264' | 'h265'
  psFsr: boolean
  psFsrSharpness: number
  psDeband: boolean
  psPremium: boolean
  psGameLanguage: string
  psPacketLossMax: number
  psAudioBufferMs: number
  psKeyboard: boolean
  psDeadZone: number
  psButtonsByPosition: boolean
  psOptionsShareForPs: boolean
  psNativeDualSense: boolean
  psHapticStrength: number
  dualSenseSpeaker: boolean
  psTriggers: boolean
  psVibration: boolean

  // Xbox
  xboxResolution: number
  xboxBitrate: number
  xboxCodec: '' | 'high' | 'main' | 'baseline'
  xboxGameLanguage: string
  xboxFsr: boolean
  xboxFsrSharpness: number
  xboxDeband: boolean
  xboxRegionIp: string
  xboxSignalServer: string
  xboxIpv6: boolean
  xboxTurnUrl: string
  xboxTurnUsername: string
  xboxTurnCredential: string
  xboxDeadZone: number
  xboxVibration: boolean
  xboxTriggerRumble: '' | 'all' | 'left' | 'right'
  xboxSwapTriggerRumble: boolean
  xboxGamepadMix: boolean
  xboxGamepadIndex: number
  xboxPollingRate: number
  xboxCoop: boolean
  xboxAudioRumble: boolean
  xboxAudioRumbleThreshold: number
  xboxMouseKeyboard: boolean
  xboxMouseSensitivity: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: '',
  startFullscreen: false,
  fullscreenOnStream: true,
  doubleClickFullscreen: true,
  hideCursor: true,
  showGameImage: true,
  backgroundKeepalive: false,
  useVulkan: false,
  ignoreGpuBlocklist: false,
  fontSize: 15,
  uiSounds: true,
  motion: 'on',

  showStats: false,
  statsVertical: false,

  touchControls: 'auto',
  touchOpacity: 60,
  touchSize: 100,
  touchVibrate: true,

  videoFormat: '',
  brightness: 100,
  contrast: 100,
  saturation: 100,
  videoDecoder: 'prefer-hardware',

  audioOutputDevice: '',
  audioVolume: 100,

  psCloudResolution: 1080,
  psCloudBitrate: 0,
  psCloudDatacenter: 'Auto',
  psNowResolution: 1080,
  psNowBitrate: 0,
  psNowDatacenter: 'Auto',
  psCodec: 'auto',
  psFsr: true,
  psFsrSharpness: 4,
  psDeband: true,
  psPremium: false,
  psGameLanguage: '',
  psPacketLossMax: 5,
  psAudioBufferMs: 30,
  psKeyboard: true,
  psDeadZone: 8,
  psButtonsByPosition: false,
  psOptionsShareForPs: false,
  psNativeDualSense: true,
  psHapticStrength: 100,
  dualSenseSpeaker: false,
  psTriggers: true,
  psVibration: true,

  xboxResolution: 1080,
  xboxBitrate: 0,
  xboxCodec: 'high',
  xboxGameLanguage: 'en-US',
  xboxFsr: false,
  xboxFsrSharpness: 4,
  xboxDeband: false,
  xboxRegionIp: '',
  xboxSignalServer: '',
  xboxIpv6: false,
  xboxTurnUrl: '',
  xboxTurnUsername: '',
  xboxTurnCredential: '',
  xboxDeadZone: 10,
  xboxVibration: true,
  xboxTriggerRumble: '',
  xboxSwapTriggerRumble: false,
  xboxGamepadMix: false,
  xboxGamepadIndex: -1,
  xboxPollingRate: 250,
  xboxCoop: false,
  xboxAudioRumble: false,
  xboxAudioRumbleThreshold: 0.15,
  xboxMouseKeyboard: false,
  xboxMouseSensitivity: 0.5,
}

// Addresses Microsoft associates with each region.
export const XBOX_REGIONS: [string, Message][] = [
  ['', 'Varsayılan'],
  ['194.25.0.68', 'Avrupa'],
  ['4.2.2.2', 'Amerika Birleşik Devletleri'],
  ['203.41.44.20', 'Avustralya'],
  ['200.221.11.101', 'Brezilya'],
  ['210.131.113.123', 'Japonya'],
  ['168.126.63.1', 'Kore'],
  ['104.211.224.146', 'Güney Hindistan'],
  ['104.211.96.159', 'Orta Hindistan'],
]

// --- validation --------------------------------------------------------------

// Fields whose value must be one of a fixed set.
const CHOICES: { [K in keyof AppSettings]?: readonly AppSettings[K][] } = {
  language: ['', 'tr', 'en'],
  motion: ['on', 'system', 'off'],
  touchControls: ['auto', 'on', 'off'],
  videoFormat: ['', 'Stretch', 'Zoom', '16:10', '18:9', '21:9', '4:3'],
  videoDecoder: ['prefer-hardware', 'prefer-software', 'no-preference'],
  psCodec: ['auto', 'h264', 'h265'],
  xboxCodec: ['', 'high', 'main', 'baseline'],
  xboxTriggerRumble: ['', 'all', 'left', 'right'],
}

// Numeric fields and the range the settings page offers. Anything else numeric
// (resolutions, bit rates, indexes) only has to be a finite number in a sane span.
const RANGES: { [K in keyof AppSettings]?: [number, number] } = {
  fontSize: [12, 20],
  touchOpacity: [15, 100],
  touchSize: [70, 140],
  brightness: [50, 150],
  contrast: [50, 150],
  saturation: [0, 200],
  audioVolume: [0, 100],
  psAudioBufferMs: [10, 100],
  psFsrSharpness: [0, 10],
  psPacketLossMax: [1, 30],
  psDeadZone: [0, 30],
  psHapticStrength: [0, 100],
  xboxFsrSharpness: [0, 10],
  xboxDeadZone: [0, 90],
  xboxGamepadIndex: [-1, 3],
  xboxAudioRumbleThreshold: [0.01, 0.5],
  xboxMouseSensitivity: [0.1, 5],
}
const NUMBER_SPAN = 1_000_000
const MAX_TEXT = 512

/**
 * Keeps only known fields holding a value of the right kind; numbers are pulled
 * into their range. Used on every change and on what is read back from disk, so
 * a stray value from the page or an older version can never reach a service.
 */
export function sanitizeSettings(input: unknown): Partial<AppSettings> {
  const out: Record<string, unknown> = {}
  if (!input || typeof input !== 'object') return out
  for (const [key, value] of Object.entries(input)) {
    if (!(key in DEFAULT_SETTINGS)) continue
    const field = key as keyof AppSettings
    const fallback = DEFAULT_SETTINGS[field]
    if (typeof value !== typeof fallback) continue
    const choices = CHOICES[field] as readonly unknown[] | undefined
    if (choices && !choices.includes(value)) continue
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue
      const [min, max] = RANGES[field] ?? [-NUMBER_SPAN, NUMBER_SPAN]
      out[key] = Math.min(max, Math.max(min, value))
    } else if (typeof value === 'string') {
      if (value.length > MAX_TEXT) continue
      out[key] = value
    } else out[key] = value
  }
  return out as Partial<AppSettings>
}
