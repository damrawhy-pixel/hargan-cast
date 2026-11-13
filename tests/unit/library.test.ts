import { describe, expect, it } from 'vitest'
import { canStart, mergeXbox, psItem, sized, xboxItem } from '../../src/renderer/src/lib/items'
import { fitFor, outputSize } from '../../src/renderer/src/lib/picture'
import type { PsGame, XboxTitle } from '../../src/shared/types'

const title = (patch: Partial<XboxTitle>): XboxTitle => ({ titleId: '1', productId: 'P', name: 'Halo', categories: [], recent: false, ...patch }) as XboxTitle

describe('outputSize', () => {
  const frame = { width: 1920, height: 1080 }
  it('letterboxes when containing', () => expect(outputSize({ width: 2000, height: 2000 }, frame, 'contain')).toEqual({ width: 2000, height: 1125 }))
  it('overflows when covering', () => expect(outputSize({ width: 2000, height: 2000 }, frame, 'cover')).toEqual({ width: 3556, height: 2000 }))
  it('takes the box when filling', () => expect(outputSize({ width: 800.4, height: 0 }, frame, 'fill')).toEqual({ width: 800, height: 1 }))
  it('maps the video format setting', () => {
    expect(fitFor('')).toBe('contain')
    expect(fitFor('Zoom')).toBe('cover')
    expect(fitFor('21:9')).toBe('fill')
  })
})

describe('mergeXbox', () => {
  it('joins cloud and library titles by name, keeping library-only ones', () => {
    const cloud = [title({ titleId: 'c1', name: 'Halo: Infinite', entitled: true })]
    const library = [title({ titleId: 'l1', name: 'HALO INFINITE', owned: true }), title({ titleId: 'l2', name: 'Forza', owned: true })]
    const merged = mergeXbox(cloud, library)
    expect(merged.map((t) => t.titleId)).toEqual(['c1', 'l2'])
    expect(merged[0]).toMatchObject({ entitled: true, owned: true })
  })
})

describe('hub items', () => {
  it('resizes Microsoft store art only', () => {
    expect(sized('https://store-images.s-microsoft.com/image/x', 360)).toContain('w=360')
    expect(sized('https://store-images.s-microsoft.com/image/x?w=1', 360)).toBe('https://store-images.s-microsoft.com/image/x?w=1')
    expect(sized('https://other/x', 360)).toBe('https://other/x')
  })

  it('lets only entitled Xbox titles play', () => {
    expect(xboxItem(title({ entitled: true })).action).toBe('play')
    expect(xboxItem(title({ entitled: false })).action).toBe('none')
  })

  it('needs Premium for PlayStation streams', () => {
    const ps = psItem({ productId: 'p', name: 'G', imageUrl: '', landscapeImageUrl: '', category: 'streamable', platform: 'ps5', isOwned: false, streamServiceType: 'pscloud', streamIdentifier: 's', genre: 'ACTION' } as PsGame)
    expect(ps.subtitle).toBe('PS5 · Aksiyon')
    expect(canStart(ps, false)).toBe(false)
    expect(canStart(ps, true)).toBe(true)
  })

  it('sends store-only PlayStation games to the store', () => {
    const ps = psItem({ productId: 'p', name: 'G', imageUrl: '', landscapeImageUrl: '', category: 'purchaseable', platform: 'ps4', isOwned: false, streamServiceType: 'psnow', streamIdentifier: 's' } as PsGame)
    expect(ps.action).toBe('store')
  })
})
