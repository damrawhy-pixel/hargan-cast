import { useSyncExternalStore } from 'react'
import type { PsCatalog, PsStatus, XboxActiveSession, XboxStatus, XboxTitle } from '../../../shared/types'
import { mergeXbox, psItem, xboxItem, type HubItem } from './items'
import { readSetting, writeSetting } from './settings'

interface State {
  ps: PsStatus
  xbox: XboxStatus
  psCatalog?: PsCatalog
  psItems: HubItem[]
  psLoading: boolean
  psError?: string
  xboxItems: HubItem[]
  xboxLoading: boolean
  xboxError?: string
  recents: string[]
  spotlight?: HubItem
  xboxRunning?: XboxActiveSession
}

const MAX_RECENTS = 16
const SPOTLIGHT_DELAY_MS = 110

let state: State = {
  ps: { state: 'restoring' },
  xbox: { state: 'restoring', hasCloud: false },
  psItems: [],
  psLoading: false,
  // The live list takes seconds; the last one shows meanwhile.
  xboxItems: readSetting<XboxTitle[]>('xboxTitles', []).map(xboxItem),
  xboxLoading: false,
  recents: readSetting<string[]>('recents', []),
}
const listeners = new Set<() => void>()

function patch(next: Partial<State>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

// The first screenful of each library is fetched ahead, so opening a tab shows art at once.
const PRELOAD_ART = 28
function preloadArt(items: HubItem[]) {
  const load = () => {
    for (const item of items.filter((i) => i.action === 'play').slice(0, PRELOAD_ART)) if (item.art) new Image().src = item.art
  }
  requestIdleCallback(load, { timeout: 3000 })
}

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function loadPlayStation(force = false) {
  if (state.psLoading) return
  patch({ psLoading: true, psError: undefined })
  window.hc.ps
    .catalog(force)
    .then((psCatalog) => {
      const psItems = psCatalog.games.map(psItem)
      patch({ psCatalog, psItems, psLoading: false })
      preloadArt(psItems)
    })
    .catch((e: Error) => patch({ psError: clean(e), psLoading: false }))
}

export function loadXbox() {
  if (state.xboxLoading) return
  patch({ xboxLoading: true, xboxError: undefined })
  const cloud: Promise<XboxTitle[]> = state.xbox.hasCloud ? window.hc.xbox.titles() : Promise.resolve([])
  // Either source can fail alone; the other is still worth showing.
  Promise.allSettled([cloud, window.hc.xbox.library()]).then(([titles, library]) => {
    const failed = [titles, library].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    const merged = mergeXbox(titles.status === 'fulfilled' ? titles.value : [], library.status === 'fulfilled' ? library.value : [])
    const xboxItems = merged.map(xboxItem)
    patch({ xboxItems, xboxLoading: false, xboxError: failed ? clean(failed.reason) : undefined })
    preloadArt(xboxItems)
    if (merged.length > 0) writeSetting('xboxTitles', merged)
    if (state.xbox.hasCloud) void window.hc.xbox.activeSessions().then((sessions) => patch({ xboxRunning: sessions[0] }))
  })
}

function onPs(ps: PsStatus) {
  const wasIn = state.ps.state === 'signedIn'
  patch({ ps })
  if (ps.state === 'signedIn' && !wasIn) loadPlayStation()
  if (ps.state === 'signedOut') patch({ psCatalog: undefined, psItems: [] })
}

function onXbox(xbox: XboxStatus) {
  const previous = state.xbox
  patch({ xbox })
  const signedInNow = xbox.state === 'signedIn' && previous.state !== 'signedIn'
  if (signedInNow || (xbox.state === 'signedIn' && xbox.hasCloud !== previous.hasCloud)) loadXbox()
  if (xbox.state === 'signedOut') {
    writeSetting('xboxTitles', [])
    patch({ xboxItems: [] })
  }
}

void window.hc.ps.status().then(onPs)
void window.hc.xbox.status().then(onXbox)
window.hc.ps.onStatus(onPs)
window.hc.xbox.onStatus(onXbox)

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => select(state),
  )
}

// Hovering across a row must not repaint the backdrop for every tile passed.
let spotlightTimer: ReturnType<typeof setTimeout> | undefined
export function setSpotlight(item: HubItem) {
  clearTimeout(spotlightTimer)
  spotlightTimer = setTimeout(() => {
    if (state.spotlight?.key !== item.key || state.spotlight.hero !== item.hero) patch({ spotlight: item })
  }, SPOTLIGHT_DELAY_MS)
}

export const clearXboxRunning = () => patch({ xboxRunning: undefined })

export function rememberPlayed(item: HubItem) {
  const recents = [item.key, ...state.recents.filter((k) => k !== item.key)].slice(0, MAX_RECENTS)
  writeSetting('recents', recents)
  patch({ recents })
}
