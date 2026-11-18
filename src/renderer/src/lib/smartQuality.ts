// Advice from a game's own last streams: lost packets, skipped frames or a frame
// rate well under 60 in most of them means the bit rate asks more of the line
// than it carries, so one step down; clean streams after such a step mean it can
// go back up. The advice is a change to the game's own settings, never applied
// without the user's say.
import type { AppSettings, GameProfile } from '../../../shared/settings'
import { settingsFor } from '../../../shared/settings'
import type { Message } from '../../../shared/i18n'
import { PS_RATES, XBOX_CAPS } from './bitrate'
import type { StreamRecord } from './history'

const RECENT = 3
const NEEDED = 2
// Per second of play: packets lost and frames skipped that count as trouble.
const LOSS_PER_SECOND = 0.5
const SKIPS_PER_SECOND = 0.05
const LOW_FPS = 50
const CLEAN_FPS = 58

export interface QualityAdvice {
  direction: 'down' | 'up'
  /** What was seen, worded for the user. */
  reason: Message
  /** The new bit rate, Mb/s, for the message. */
  mbps: number
  patch: GameProfile
}

const troubled = (r: StreamRecord) => r.lost / Math.max(1, r.seconds) > LOSS_PER_SECOND || r.skipped / Math.max(1, r.seconds) > SKIPS_PER_SECOND || r.avgFps < LOW_FPS
const clean = (r: StreamRecord) => r.lost / Math.max(1, r.seconds) < LOSS_PER_SECOND / 5 && r.skipped / Math.max(1, r.seconds) < SKIPS_PER_SECOND / 5 && r.avgFps >= CLEAN_FPS

function step(rates: number[], from: number, direction: 'down' | 'up') {
  if (direction === 'down') return [...rates].reverse().find((r) => r < from)
  return rates.find((r) => r > from)
}

export function adviseQuality(history: StreamRecord[], key: string, settings: AppSettings): QualityAdvice | undefined {
  const recent = history.filter((r) => r.key === key).slice(0, RECENT)
  if (recent.length < NEEDED) return undefined
  const effective = settingsFor(settings, key)
  const own = settings.gameProfiles[key] ?? {}
  const avgMbps = recent.reduce((sum, r) => sum + r.avgMbps, 0) / recent.length

  const down = recent.filter(troubled).length >= NEEDED
  // Going back up only undoes a step this game was given; automatic stays the ceiling.
  const up = !down && recent.every(clean)

  if (key.startsWith('xbox:')) {
    const cap = effective.xboxBitrate || Math.ceil(avgMbps)
    const next = down ? step(XBOX_CAPS, Math.min(cap, Math.ceil(avgMbps)), 'down') : up && own.xboxBitrate ? step(XBOX_CAPS, own.xboxBitrate, 'up') ?? 0 : undefined
    if (next === undefined) return undefined
    return { direction: down ? 'down' : 'up', reason: down ? 'Son akışlarda kayıp ve takılma vardı.' : 'Son akışlar temizdi.', mbps: next, patch: { xboxBitrate: next } }
  }

  if (key.startsWith('ps:') || key.startsWith('console:')) {
    const remote = key.startsWith('console:')
    const current = remote ? effective.psRemoteBitrate : Math.max(effective.psCloudBitrate, effective.psNowBitrate)
    const ownRate = remote ? own.psRemoteBitrate : own.psCloudBitrate
    // On automatic the stream's own rate is the starting point.
    const from = current || Math.round(avgMbps * 1000)
    const next = down ? step(PS_RATES, from, 'down') : up && ownRate ? step(PS_RATES, ownRate, 'up') : undefined
    if (next === undefined) return undefined
    const patch: GameProfile = remote ? { psRemoteBitrate: next } : { psCloudBitrate: next, psNowBitrate: next }
    return { direction: down ? 'down' : 'up', reason: down ? 'Son akışlarda kayıp ve takılma vardı.' : 'Son akışlar temizdi.', mbps: next / 1000, patch }
  }
  return undefined
}
