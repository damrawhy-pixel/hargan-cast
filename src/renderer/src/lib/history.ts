// A record of each stream: its averages and, second by second (thinned out for
// long sessions), frame rate, bit rate and measured delay. Kept on this device
// only, so "it stuttered yesterday" can be looked at afterwards.
import { readSetting, writeSetting } from './settings'

const KEY = 'streamHistory'
const MAX_SESSIONS = 20
const MAX_POINTS = 240

export interface StreamRecord {
  at: string
  platform: string
  /** The game's or console's settings key ("ps:<productId>", "xbox:<titleId>", "console:<id>"). */
  key?: string
  title: string
  seconds: number
  /** Seconds from start to the first picture; undefined when none came. */
  toPicture?: number
  avgFps: number
  minFps: number
  avgMbps: number
  avgDelay?: number
  lost: number
  skipped: number
  size: string
  fps: number[]
  mbps: number[]
  /** Measured delay per sample, null where it was not known. */
  delay: (number | null)[]
}

/** At most `max` points, each the average of the stretch it stands for. */
export function thin<T extends number | null>(values: T[], max = MAX_POINTS): T[] {
  if (values.length <= max) return values.slice()
  const out: T[] = []
  const step = values.length / max
  for (let i = 0; i < max; i++) {
    const part = values.slice(Math.floor(i * step), Math.floor((i + 1) * step)).filter((v): v is NonNullable<T> => v !== null)
    out.push((part.length ? Math.round((part.reduce((a, b) => a + (b as number), 0) / part.length) * 10) / 10 : null) as T)
  }
  return out
}

export const readHistory = () => readSetting<StreamRecord[]>(KEY, [])

export function saveRecord(record: StreamRecord) {
  const kept: StreamRecord = { ...record, fps: thin(record.fps), mbps: thin(record.mbps), delay: thin(record.delay) }
  writeSetting(KEY, [kept, ...readHistory()].slice(0, MAX_SESSIONS))
}

export const clearHistory = () => writeSetting(KEY, [])
