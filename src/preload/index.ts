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
    onStatus: subscribe('ps:statusChanged'),
    onEvent: subscribe('ps:event'),
  } as HarganApi['ps'],
}

contextBridge.exposeInMainWorld('hc', api)
