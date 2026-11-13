// Interface text. Turkish is the source language: every message is written in
// Turkish at its call site, as t('...'), and that text is the key into the other
// languages' dictionaries. A message missing from a dictionary is a type error,
// so a new or changed Turkish text cannot ship untranslated.
//
// Placeholders are written {name} and filled from the second argument.
import { en } from './en'

export type Language = 'tr' | 'en'
export type Message = keyof typeof en
export type LanguageSetting = '' | Language

export const LANGUAGES: readonly Language[] = ['tr', 'en']

const dictionaries: Record<Exclude<Language, 'tr'>, Record<Message, string>> = { en }

let current: Language = 'tr'
const listeners = new Set<() => void>()

/** The language a setting means; '' follows the system's. */
export function resolveLanguage(setting: LanguageSetting | undefined, systemLocale: string): Language {
  if (setting === 'tr' || setting === 'en') return setting
  return systemLocale.toLowerCase().startsWith('tr') ? 'tr' : 'en'
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

/** A BCP 47 tag for dates, numbers and Accept-Language headers. */
export const locale = () => (current === 'tr' ? 'tr-TR' : 'en-US')

export function t(message: Message, params?: Record<string, string | number>): string {
  const text = current === 'tr' ? message : (dictionaries[current][message] ?? message)
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : text
}

/** For text that arrives at runtime (a native error, a stored reason): translated if known. */
export function tryT(text: string): string {
  return current !== 'tr' && text in dictionaries[current] ? dictionaries[current][text as Message] : text
}
