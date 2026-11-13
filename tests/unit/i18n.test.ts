import { afterEach, describe, expect, it } from 'vitest'
import { getLanguage, resolveLanguage, setLanguage, t, tryT, type Message } from '../../src/shared/i18n'
import { en } from '../../src/shared/i18n/en'

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

afterEach(() => setLanguage('tr'))

describe('dictionaries', () => {
  it('keep every placeholder of the Turkish text', () => {
    for (const [tr, english] of Object.entries(en)) expect(placeholders(english), tr).toEqual(placeholders(tr))
  })

  it('have no empty translations', () => {
    for (const [tr, english] of Object.entries(en)) expect(english.trim(), tr).not.toBe('')
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

  it('translates runtime text only when it is known', () => {
    setLanguage('en')
    expect(tryT('Komut boş')).toBe('Empty command')
    expect(tryT('Something from a server')).toBe('Something from a server')
  })
})

describe('resolveLanguage', () => {
  it('follows the system when unset', () => {
    expect(resolveLanguage('', 'tr-TR')).toBe('tr')
    expect(resolveLanguage('', 'de-DE')).toBe('en')
  })

  it('obeys an explicit choice', () => {
    expect(resolveLanguage('en', 'tr-TR')).toBe('en')
    expect(resolveLanguage('tr', 'en-US')).toBe('tr')
    expect(getLanguage()).toBe('tr')
  })
})
