import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))
const { redact, safeUrl } = await import('../../src/main/log')

describe('redact', () => {
  it('hides authorization values', () => {
    expect(redact('Authorization: Bearer abc.def')).toBe('Authorization: Bearer [gizli]')
    expect(redact('XBL3.0 x=123;eyJ')).toBe('XBL3.0 [gizli]')
  })

  it('hides the Sony session', () => {
    expect(redact(`npsso=${'A'.repeat(64)}`)).toBe('npsso=[gizli]')
    expect(redact(`{"npsso":"${'b'.repeat(64)}"}`)).toBe('{"npsso":"[gizli]"}')
  })

  it('hides query strings and JWTs', () => {
    expect(redact('GET https://a.example/path?code=secret done')).toBe('GET https://a.example/path?[gizli] done')
    expect(redact(`token ${'a'.repeat(30)}.${'b'.repeat(30)}.${'c'.repeat(20)}`)).toBe('token [gizli-jwt]')
  })

  it('leaves plain text alone', () => expect(redact('ps core exited (code 0)')).toBe('ps core exited (code 0)'))
})

describe('safeUrl', () => {
  it('keeps only origin and path', () => expect(safeUrl('https://x.com/a/b?c=1#d')).toBe('https://x.com/a/b'))
  it('copes with garbage', () => expect(safeUrl('::')).toBe('invalid-url'))
})
