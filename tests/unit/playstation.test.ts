import { describe, expect, it } from 'vitest'
import {
  catalogContext,
  extractNpsso,
  friendlyError,
  parseDatacenters,
  parseStorePage,
  SESSION_EXPIRED,
  signInUrl,
  storePageHasDetails,
  storePages,
  streamArgs,
} from '../../src/main/playstation/common'
import { psQuit, psStage } from '../../src/renderer/src/playstation/stages'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import type { PsGame } from '../../src/shared/types'

const NPSSO = 'Ab3'.repeat(20) + 'Cd5e'

const game = (patch: Partial<PsGame> = {}): PsGame => ({
  productId: 'EP0001-PPSA01234_00-GAME000000000000',
  name: 'Game',
  imageUrl: '',
  landscapeImageUrl: '',
  category: 'streamable',
  platform: 'ps5',
  isOwned: false,
  streamServiceType: 'pscloud',
  streamIdentifier: 'PPSA01234_00',
  ...patch,
})

describe('extractNpsso', () => {
  it('takes the raw value', () => expect(extractNpsso(NPSSO)).toBe(NPSSO))
  it('takes the token page JSON', () => expect(extractNpsso(`{"npsso":"${NPSSO}"}`)).toBe(NPSSO))
  it('refuses something else', () => expect(() => extractNpsso('hello')).toThrow())
})

describe('signInUrl', () => {
  it('carries the client id and the cid', () => {
    const url = new URL(signInUrl('abc'))
    expect(url.host).toBe('ca.account.sony.com')
    expect(url.searchParams.get('cid')).toBe('abc')
    expect(url.searchParams.get('response_type')).toBe('code')
  })
})

describe('catalogContext', () => {
  it('reads region and language from the settled locale', () => {
    expect(catalogContext({ settledLocale: 'tr-TR', nativeMode: true })).toEqual({ country: 'TR', lang: 'tr', foreign: false })
  })
  it('prefers the fallback region and resolved store language', () => {
    expect(catalogContext({ settledLocale: 'tr-TR', fallbackRegion: 'gb', resolvedStoreLang: 'EN' })).toEqual({ country: 'GB', lang: 'en', foreign: true })
  })
  it('falls back to en-US', () => {
    expect(catalogContext({})).toMatchObject({ country: 'US', lang: 'en' })
  })
})

describe('streamArgs', () => {
  const context = { country: 'TR', lang: 'tr', foreign: false }
  const memory = { npsso: NPSSO, locale: 'tr-TR', attrPassed: true, priorDatacenters: '[]' }

  it('uses the cloud settings and the automatic bit rate', () => {
    const args = streamArgs(game(), { hevc: true }, { ...DEFAULT_SETTINGS, psCloudResolution: 1440 }, context, memory)
    expect(args).toMatchObject({ service: 'pscloud', resolution: 1440, bitrate: 30000, hevc: true, ownedEntitlement: '', gameLang: 'tr-TR' })
  })

  it('passes the entitlement only for owned PS Now games', () => {
    const owned = game({ streamServiceType: 'psnow', isOwned: true, entitlementId: 'ENT', platform: 'ps4' })
    expect(streamArgs(owned, { hevc: false }, DEFAULT_SETTINGS, context, memory)).toMatchObject({ ownedEntitlement: 'ENT', ownedPlatform: 'ps4' })
  })

  it('keeps a bit rate the user chose', () => {
    expect(streamArgs(game(), { hevc: false }, { ...DEFAULT_SETTINGS, psCloudBitrate: 15000 }, context, memory).bitrate).toBe(15000)
  })
})

describe('parseDatacenters', () => {
  it('sorts by round trip and skips nameless entries', () => {
    const stored = JSON.stringify([{ dataCenter: 'b', rtt: 40 }, { rtt: 1 }, { dataCenter: 'a', rtt: 12 }, { dataCenter: 'c' }])
    expect(parseDatacenters(stored)).toEqual([{ name: 'a', rttMs: 12 }, { name: 'b', rttMs: 40 }, { name: 'c', rttMs: undefined }])
  })
  it('survives garbage', () => expect(parseDatacenters('not json')).toEqual([]))
})

describe('store page', () => {
  it('asks in the catalog language and falls back to the concept page', () => {
    const { locale, pages } = storePages(game({ conceptUrl: 'https://store.playstation.com/concept/1' }), { country: 'TR', lang: 'tr', foreign: false })
    expect(locale).toBe('tr-tr')
    expect(pages).toHaveLength(2)
    expect(pages[0]).toContain('/tr-tr/product/')
  })

  it('reads description, art and rating from the embedded data', () => {
    const html = [
      '"__typename":"Description","type":"LONG","value":"Line one<br>Line \\"two\\""',
      '"role":"SCREENSHOT","type":"IMAGE","url":"https://img/1.png"',
      '"role":"SCREENSHOT","type":"IMAGE","url":"https://img/1.png"',
      '"role":"GAMEHUB_COVER_ART","type":"IMAGE","url":"https://img/hero.png"',
      '"averageRating":4.62,"totalRatingsCount":1200',
    ].join(',')
    expect(storePageHasDetails(html)).toBe(true)
    expect(parseStorePage(html)).toEqual({
      description: 'Line one\nLine "two"',
      hero: 'https://img/hero.png',
      logo: undefined,
      screenshots: ['https://img/1.png'],
      community: { average: 4.62, count: 1200 },
    })
  })

  it('gives nothing for an empty page', () => {
    expect(parseStorePage('')).toMatchObject({ description: undefined, screenshots: [], community: undefined })
  })
})

describe('messages', () => {
  it('words Sony errors for people', () => {
    expect(friendlyError('AUTHORIZATION_FAILED')).toBe(SESSION_EXPIRED)
    expect(friendlyError('{"error":1}')).not.toContain('{')
    expect(friendlyError('Something new')).toBe('Something new')
  })

  it('translates progress and keeps the queue position', () => {
    expect(psStage('Allocating streaming slot. Queue position: 7')).toEqual({ text: 'Akış sunucusu ayrılıyor', position: 7 })
    expect(psStage('Migrating data (40%)').text).toBe('Oyun verileri taşınıyor (%40)')
    expect(psStage('Unknown').text).toBe('Hazırlanıyor')
  })

  it('explains why a session ended', () => {
    expect(psQuit('Server shut down')).toContain('Sunucu')
    expect(psQuit('whatever')).toBe('PlayStation bağlantısı kesildi')
  })
})
