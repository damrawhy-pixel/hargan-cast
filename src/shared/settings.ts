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
  /** Desktop: also install pre-releases. */
  betaUpdates: boolean
  /** Desktop: start with Windows. */
  launchAtLogin: boolean
  /** Per game (HubItem key, e.g. "ps:<productId>"), the picture settings that differ from these. */
  gameProfiles: Record<string, GameProfile>
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
  /** Colour-blindness correction for the stream picture. */
  colorAssist: 'off' | 'protan' | 'deutan' | 'tritan'
  videoDecoder: 'prefer-hardware' | 'prefer-software' | 'no-preference'
  /**
   * Who scales the picture to the screen: the app's own shaders (FSR, debanding)
   * or the graphics card's video path (NVIDIA RTX Video, Intel VSR, the OS scaler),
   * which also lets the picture go straight to the display as a hardware overlay.
   */
  upscaler: 'shader' | 'system'
  /** 'latency' shows each frame as it arrives; 'smooth' holds a frame or two to show them evenly. */
  framePacing: 'latency' | 'smooth'
  /** The "fit this computer" step has been run or declined. */
  autoTuned: boolean
  /** Desktop: while streaming, switch the monitor to a multiple of 60 Hz (144 to 120). */
  matchRefreshRate: boolean
  /** Desktop: keep the last replaySeconds of a stream, to save as a clip. */
  replayBuffer: boolean
  replaySeconds: number
  /** Show the game being played in Discord; offered only in builds with a Discord app id. */
  discordPresence: boolean

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
  /** PS5 cloud games: offer HDR to Sony (experimental; SDR if refused). */
  psCloudHdr: boolean
  // Remote Play with the user's own console
  psRemoteResolution: number
  /** kb/s; 0 picks by resolution. */
  psRemoteBitrate: number
  psRemoteFps: number
  /** PS5 only: HDR when the screen and the decoder can show it. */
  psHdr: boolean
  /** Remote Play: send the microphone to the console, for party and game chat. */
  psMicrophone: boolean
  /** Android: decode PlayStation streams with MediaCodec straight to the screen. */
  psNativeVideo: boolean
  /** The app's own upscaling and sharpening, with psScaler choosing how. */
  psFsr: boolean
  psScaler: 'fsr' | 'lanczos'
  psFsrSharpness: number
  psDeband: boolean
  /** Edge-preserving filter against compression noise. */
  psDenoise: boolean
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

  // Controller layout, both services
  /** '' is the standard layout; otherwise, for each standard button, the physical one that presses it. */
  buttonMap: string
  swapSticks: boolean
  /** Inverts the right stick's vertical axis. */
  invertY: boolean

  // Xbox
  xboxResolution: number
  xboxBitrate: number
  xboxCodec: '' | 'high' | 'main' | 'baseline'
  xboxGameLanguage: string
  xboxFsr: boolean
  xboxScaler: 'fsr' | 'lanczos'
  xboxFsrSharpness: number
  xboxDeband: boolean
  xboxDenoise: boolean
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
  /** Desktop: a DualSense's gyro moves the right stick, always or while LT is held. */
  xboxGyro: 'off' | 'always' | 'aim'
  xboxGyroSensitivity: number
  xboxGyroInvertX: boolean
  xboxGyroInvertY: boolean
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
  betaUpdates: false,
  launchAtLogin: false,
  gameProfiles: {},
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
  colorAssist: 'off',
  videoDecoder: 'prefer-hardware',
  upscaler: 'shader',
  framePacing: 'latency',
  autoTuned: false,
  matchRefreshRate: false,
  replayBuffer: false,
  replaySeconds: 30,
  discordPresence: false,

  audioOutputDevice: '',
  audioVolume: 100,

  psCloudResolution: 1080,
  psCloudBitrate: 0,
  psCloudDatacenter: 'Auto',
  psNowResolution: 1080,
  psNowBitrate: 0,
  psNowDatacenter: 'Auto',
  psCodec: 'auto',
  psCloudHdr: false,
  psRemoteResolution: 1080,
  psRemoteBitrate: 0,
  psRemoteFps: 60,
  psHdr: true,
  psNativeVideo: false,
  psMicrophone: false,
  psFsr: true,
  psScaler: 'fsr',
  psFsrSharpness: 4,
  psDeband: true,
  psDenoise: false,
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

  buttonMap: '',
  swapSticks: false,
  invertY: false,

  xboxResolution: 1080,
  xboxBitrate: 0,
  xboxCodec: 'high',
  xboxGameLanguage: 'en-US',
  xboxFsr: false,
  xboxScaler: 'fsr',
  xboxFsrSharpness: 4,
  xboxDeband: false,
  xboxDenoise: false,
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
  xboxGyro: 'off',
  xboxGyroSensitivity: 1,
  xboxGyroInvertX: false,
  xboxGyroInvertY: false,
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

// --- per-game profiles --------------------------------------------------------

/** What a game may set for itself: how its picture is asked for and shown. */
export const PROFILE_FIELDS = [
  'videoFormat',
  'upscaler',
  'framePacing',
  'psCloudResolution',
  'psCloudBitrate',
  'psNowResolution',
  'psNowBitrate',
  'psRemoteResolution',
  'psRemoteBitrate',
  'psHdr',
  'psFsr',
  'psScaler',
  'psFsrSharpness',
  'psDeband',
  'psDenoise',
  'xboxResolution',
  'xboxBitrate',
  'xboxFsr',
  'xboxScaler',
  'xboxFsrSharpness',
  'xboxDeband',
  'xboxDenoise',
  'buttonMap',
  'swapSticks',
  'invertY',
  'xboxGyro',
  'xboxGyroSensitivity',
] as const satisfies readonly (keyof AppSettings)[]

export type GameProfile = Partial<Pick<AppSettings, (typeof PROFILE_FIELDS)[number]>>

const MAX_PROFILES = 500
const MAX_PROFILE_KEY = 200

/** The settings a stream of this game runs with: the general ones, then its profile. */
export const settingsFor = (settings: AppSettings, gameKey: string): AppSettings => ({ ...settings, ...settings.gameProfiles?.[gameKey] })

function sanitizeProfiles(input: object): Record<string, GameProfile> {
  const out: Record<string, GameProfile> = {}
  for (const [key, value] of Object.entries(input).slice(0, MAX_PROFILES)) {
    if (key.length > MAX_PROFILE_KEY) continue
    const clean = sanitizeSettings(value) as Record<string, unknown>
    const profile = Object.fromEntries(Object.entries(clean).filter(([field]) => (PROFILE_FIELDS as readonly string[]).includes(field)))
    if (Object.keys(profile).length) out[key] = profile as GameProfile
  }
  return out
}

// --- validation --------------------------------------------------------------

// Fields whose value must be one of a fixed set.
const CHOICES: { [K in keyof AppSettings]?: readonly AppSettings[K][] } = {
  language: ['', 'tr', 'en'],
  motion: ['on', 'system', 'off'],
  touchControls: ['auto', 'on', 'off'],
  videoFormat: ['', 'Stretch', 'Zoom', '16:10', '18:9', '21:9', '4:3'],
  videoDecoder: ['prefer-hardware', 'prefer-software', 'no-preference'],
  upscaler: ['shader', 'system'],
  framePacing: ['latency', 'smooth'],
  colorAssist: ['off', 'protan', 'deutan', 'tritan'],
  psCodec: ['auto', 'h264', 'h265'],
  psScaler: ['fsr', 'lanczos'],
  psRemoteResolution: [720, 1080, 1440, 2160],
  psRemoteFps: [30, 60],
  replaySeconds: [15, 30, 60, 120],
  xboxScaler: ['fsr', 'lanczos'],
  xboxCodec: ['', 'high', 'main', 'baseline'],
  xboxTriggerRumble: ['', 'all', 'left', 'right'],
  xboxGyro: ['off', 'always', 'aim'],
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
  xboxGyroSensitivity: [0.2, 4],
}
const NUMBER_SPAN = 1_000_000
// Eighteen button indexes, 0 to 17.
const BUTTON_MAP = /^(?:(?:1[0-7]|[0-9]),){17}(?:1[0-7]|[0-9])$/
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
    if (field === 'gameProfiles') {
      if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = sanitizeProfiles(value)
      continue
    }
    const choices = CHOICES[field] as readonly unknown[] | undefined
    if (choices && !choices.includes(value)) continue
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue
      const [min, max] = RANGES[field] ?? [-NUMBER_SPAN, NUMBER_SPAN]
      out[key] = Math.min(max, Math.max(min, value))
    } else if (typeof value === 'string') {
      if (value.length > MAX_TEXT) continue
      if (field === 'buttonMap' && value && !BUTTON_MAP.test(value)) continue
      out[key] = value
    } else out[key] = value
  }
  return out as Partial<AppSettings>
}
