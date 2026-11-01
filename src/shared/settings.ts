export type VideoFormat = '' | 'Stretch' | 'Zoom' | '16:10' | '18:9' | '21:9' | '4:3'

export interface AppSettings {
  // General
  startFullscreen: boolean
  fullscreenOnStream: boolean
  doubleClickFullscreen: boolean
  hideCursor: boolean
  showGameImage: boolean
  backgroundKeepalive: boolean
  useVulkan: boolean
  fontSize: number

  // Stats
  showStats: boolean
  statsVertical: boolean

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
  psTriggers: boolean
  psVibration: boolean

  // Xbox
  xboxResolution: number
  xboxBitrate: number
  xboxAudioBitrate: number
  xboxCodec: '' | 'high' | 'main' | 'baseline'
  xboxGameLanguage: string
  xboxFsr: boolean
  xboxFsrSharpness: number
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
  startFullscreen: false,
  fullscreenOnStream: true,
  doubleClickFullscreen: true,
  hideCursor: true,
  showGameImage: true,
  backgroundKeepalive: false,
  useVulkan: false,
  fontSize: 15,

  showStats: false,
  statsVertical: false,

  videoFormat: '',
  brightness: 100,
  contrast: 100,
  saturation: 100,
  videoDecoder: 'prefer-hardware',

  audioOutputDevice: '',
  audioVolume: 100,

  psCloudResolution: 1080,
  psCloudBitrate: 20000,
  psCloudDatacenter: 'Auto',
  psNowResolution: 1080,
  psNowBitrate: 20000,
  psNowDatacenter: 'Auto',
  psCodec: 'auto',
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
  psTriggers: true,
  psVibration: true,

  xboxResolution: 1080,
  xboxBitrate: 0,
  xboxAudioBitrate: 0,
  xboxCodec: 'high',
  xboxGameLanguage: 'en-US',
  xboxFsr: false,
  xboxFsrSharpness: 2,
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
export const XBOX_REGIONS: [string, string][] = [
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
