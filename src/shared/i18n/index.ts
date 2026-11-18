// Interface text. Turkish is the source language: every message is written in
// Turkish at its call site, as t('...'), and that text is the key into the other
// languages' dictionaries. A message missing from a dictionary is a type error,
// so a new or changed Turkish text cannot ship untranslated.
//
// Placeholders are written {name} and filled from the second argument.
import { ar } from './ar'
import { de } from './de'
import { en } from './en'

export type Language = 'tr' | 'en' | 'de' | 'ar'
export type Message = keyof typeof en
export type LanguageSetting = '' | Language

export const LANGUAGES: readonly Language[] = ['tr', 'en', 'de', 'ar']

/** Each language's own name, as its speakers write it. */
export const LANGUAGE_NAMES: Record<Language, string> = { tr: 'Türkçe', en: 'English', de: 'Deutsch', ar: 'العربية' }

const dictionaries: Record<Exclude<Language, 'tr'>, Record<Message, string>> = { en, de, ar }

// Arabic numbers keep Western digits, as the stream's own figures do.
const TAGS: Record<Language, string> = { tr: 'tr-TR', en: 'en-US', de: 'de-DE', ar: 'ar-u-nu-latn' }
const CONTENT: Record<Language, string> = { tr: 'tr-TR', en: 'en-US', de: 'de-DE', ar: 'ar-SA' }

let current: Language = 'tr'
const listeners = new Set<() => void>()

/** The language a setting means; '' follows the system's. */
export function resolveLanguage(setting: LanguageSetting | undefined, systemLocale: string): Language {
  if (setting && LANGUAGES.includes(setting)) return setting
  const system = systemLocale.toLowerCase().slice(0, 2)
  return LANGUAGES.find((language) => language === system) ?? 'en'
}

export function setLanguage(language: Language) {
  if (language === current) return
  current = language
  listeners.forEach((l) => l())
}

export const getLanguage = () => current

export function onLanguageChange(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** A BCP 47 tag for dates and numbers. */
export const locale = () => TAGS[current]

/** The language-region pair services understand when asked for text. */
export const contentLanguage = () => CONTENT[current]

/** Arabic reads right to left; the page mirrors for it. */
export const direction = (language: Language = current): 'rtl' | 'ltr' => (language === 'ar' ? 'rtl' : 'ltr')

export function t(message: Message, params?: Record<string, string | number>): string {
  const text = current === 'tr' ? message : (dictionaries[current][message] ?? message)
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : text
}

/** For text that arrives at runtime (a native error, a stored reason): translated if known. */
export function tryT(text: string): string {
  return current !== 'tr' && text in dictionaries[current] ? dictionaries[current][text as Message] : text
}
