import { contextBridge, ipcRenderer } from 'electron'
import type { HarganApi } from '../shared/types'

const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const subscribe = (channel: string) => (cb: (payload: any) => void) => {
  const listener = (_e: unknown, payload: unknown) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.off(channel, listener)
  }
}

const api: HarganApi = {
  platform: {
    fullscreen: (on) => ipcRenderer.send('app:fullscreen', on),
    toggleFullscreen: () => ipcRenderer.send('app:toggleFullscreen'),
    streaming: (on) => ipcRenderer.send('app:streaming', on),
    openExternal: (url) => ipcRenderer.send('app:external', url),
    openLicenses: () => ipcRenderer.send('app:licenses'),
    log: (text) => ipcRenderer.send('app:log', String(text).slice(0, 1000)),
    reportError: (text) => ipcRenderer.send('app:error', String(text).slice(0, 4000)),
    exportDiagnostics: () => ipcRenderer.invoke('app:diagnostics'),
    networkTest: () => ipcRenderer.invoke('app:networkTest'),
    screenshot: (title: string) => ipcRenderer.invoke('app:screenshot', title),
    saveClip: (title: string, data: ArrayBuffer) => ipcRenderer.invoke('app:saveClip', title, data),
    showCapture: (file: string) => ipcRenderer.send('app:showCapture', file),
    takeLaunch: () => ipcRenderer.invoke('app:takeLaunch'),
    // The DualSense trigger bridge, the desktop shortcut and Steam entries are Windows features.
    windows: process.platform === 'win32',
    dualSenseTriggers: process.platform === 'win32' ? (left: number, right: number) => ipcRenderer.send('app:dsTriggers', left, right) : undefined,
    discord: process.argv.includes('--hc-discord'),
    gameMode: process.argv.includes('--hc-game-mode'),
    presence: (title: string, service: string) => ipcRenderer.send('app:presence', title, service),
    onLaunch: subscribe('app:launch'),
    createShortcut: process.platform === 'win32' ? (key: string, name: string) => ipcRenderer.invoke('app:createShortcut', key, name) : undefined,
    addToSteam: process.platform !== 'win32' || process.argv.includes('--hc-under-wine') ? undefined : (key: string, name: string) => ipcRenderer.invoke('app:addToSteam', key, name),
  },
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set'),
    reset: invoke('settings:reset'),
  } as HarganApi['settings'],
  xbox: {
    status: invoke('xbox:status'),
    signIn: invoke('xbox:signIn'),
    signOut: invoke('xbox:signOut'),
    titles: invoke('xbox:titles'),
    library: invoke('xbox:library'),
    info: invoke('xbox:info'),
    startStream: invoke('xbox:startStream'),
    consoles: invoke('xbox:consoles'),
    accounts: {
      list: invoke('xbox:accounts'),
      add: invoke('xbox:addAccount'),
      switch: invoke('xbox:switchAccount'),
      forget: invoke('xbox:forgetAccount'),
    },
    achievements: invoke('xbox:achievements'),
    friends: invoke('xbox:friends'),
    startHomeStream: invoke('xbox:startHomeStream'),
    activeSessions: invoke('xbox:activeSessions'),
    adoptSession: invoke('xbox:adoptSession'),
    endSession: invoke('xbox:endSession'),
    session: invoke('xbox:session'),
    stopStream: invoke('xbox:stopStream'),
    sendSdp: invoke('xbox:sendSdp'),
    sendChatSdp: invoke('xbox:sendChatSdp'),
    sendIce: invoke('xbox:sendIce'),
    keepalive: invoke('xbox:keepalive'),
    onStatus: subscribe('xbox:statusChanged'),
  } as HarganApi['xbox'],
  ps: {
    status: invoke('ps:status'),
    signIn: invoke('ps:signIn'),
    signInWithToken: invoke('ps:signInWithToken'),
    signOut: invoke('ps:signOut'),
    catalog: invoke('ps:catalog'),
    datacenters: invoke('ps:datacenters'),
    stream: invoke('ps:stream'),
    stop: invoke('ps:stop'),
    testHaptics: invoke('ps:testHaptics'),
    info: invoke('ps:info'),
    routeSpeaker: invoke('ps:routeSpeaker'),
    // The NAT test lives in the Windows core.
    natTest: process.platform === 'win32' ? invoke('ps:natTest') : undefined,
    accounts: {
      list: invoke('ps:accounts'),
      add: invoke('ps:addAccount'),
      switch: invoke('ps:switchAccount'),
      forget: invoke('ps:forgetAccount'),
      rename: invoke('ps:renameAccount'),
    },
    consoles: {
      list: invoke('ps:consoles'),
      discover: invoke('ps:discoverConsoles'),
      register: invoke('ps:registerConsole'),
      forget: invoke('ps:forgetConsole'),
      moved: invoke('ps:consoleMoved'),
      wake: invoke('ps:wakeConsole'),
      stream: invoke('ps:remoteStream'),
    },
    onStatus: subscribe('ps:statusChanged'),
    onEvent: subscribe('ps:event'),
  } as HarganApi['ps'],
}

contextBridge.exposeInMainWorld('hc', api)
