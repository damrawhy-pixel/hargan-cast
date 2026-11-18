import { afterEach, describe, expect, it } from 'vitest'
import { contentLanguage, direction, getLanguage, locale, resolveLanguage, setLanguage, t, tryT, type Message } from '../../src/shared/i18n'
import { ar } from '../../src/shared/i18n/ar'
import { de } from '../../src/shared/i18n/de'
import { en } from '../../src/shared/i18n/en'

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

afterEach(() => setLanguage('tr'))

describe.each([
  ['en', en],
  ['de', de],
  ['ar', ar],
])('the %s dictionary', (_, dictionary: Record<string, string>) => {
  it('keeps every placeholder of the Turkish text', () => {
    for (const [tr, text] of Object.entries(dictionary)) expect(placeholders(text), tr).toEqual(placeholders(tr))
  })

  it('has no empty translations', () => {
    for (const [tr, text] of Object.entries(dictionary)) expect(text.trim(), tr).not.toBe('')
  })

  it('covers every message the English one does', () => {
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort())
  })
})

describe('t', () => {
  it('gives the Turkish source text in Turkish', () => {
    expect(t('Oyna')).toBe('Oyna')
  })

  it('gives the English text in English and fills placeholders', () => {
    setLanguage('en')
    expect(t('Oyna')).toBe('Play')
    expect(t('{n} oyun', { n: 12 })).toBe('12 games')
    expect(t('Bağlantı koptu, yeniden bağlanılıyor ({n}/{max})', { n: 1, max: 3 })).toBe('Connection lost, reconnecting (1/3)')
  })

  it('leaves a placeholder without a value as it is', () => {
    expect(t('{n} oyun' as Message)).toBe('{n} oyun')
  })

  it('gives German and Arabic text', () => {
    setLanguage('de')
    expect(t('{n} oyun', { n: 3 })).toBe('3 Spiele')
    setLanguage('ar')
    expect(t('Oyna')).toBe('العب')
  })

  it('translates runtime text only when it is known', () => {
    setLanguage('en')
    expect(tryT('Komut boş')).toBe('Empty command')
    expect(tryT('Something from a server')).toBe('Something from a server')
  })
})

describe('resolveLanguage', () => {
  it('follows the system when unset', () => {
    expect(resolveLanguage('', 'tr-TR')).toBe('tr')
    expect(resolveLanguage('', 'de-DE')).toBe('de')
    expect(resolveLanguage('', 'ar-EG')).toBe('ar')
    expect(resolveLanguage('', 'fr-FR')).toBe('en')
  })

  it('obeys an explicit choice', () => {
    expect(resolveLanguage('en', 'tr-TR')).toBe('en')
    expect(resolveLanguage('tr', 'en-US')).toBe('tr')
    expect(getLanguage()).toBe('tr')
  })
})

describe('direction and locale', () => {
  it('reads Arabic right to left, with Western digits', () => {
    expect(direction('ar')).toBe('rtl')
    expect(direction('de')).toBe('ltr')
    setLanguage('ar')
    expect((1234).toLocaleString(locale())).toMatch(/^1.?234$/)
    expect(contentLanguage()).toBe('ar-SA')
  })
})
