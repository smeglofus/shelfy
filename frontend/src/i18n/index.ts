import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import cs from './cs.json'
import en from './en.json'

export type Language = 'cs' | 'en'

const STORAGE_KEY = 'shelfy.language'
const COOKIE_KEY = 'shelfy_language'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

function parseCookieLanguage(): Language | null {
  try {
    const raw = document.cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE_KEY}=`))
    const value = raw?.split('=')[1]
    if (value === 'cs' || value === 'en') return value
  } catch {
    // ignore
  }
  return null
}

function persistLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // ignore
  }

  try {
    document.cookie = `${COOKIE_KEY}=${lang}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
  } catch {
    // ignore
  }
}

function getInitialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'cs' || stored === 'en') return stored
  } catch {
    // ignore
  }

  const cookieLang = parseCookieLanguage()
  if (cookieLang) return cookieLang

  const navLang = (typeof navigator !== 'undefined' ? navigator.language : '').toLowerCase()
  if (navLang.startsWith('en')) return 'en'
  return 'cs'
}

void i18n.use(initReactI18next).init({
  resources: { cs: { translation: cs }, en: { translation: en } },
  lng: getInitialLanguage(),
  fallbackLng: 'cs',
  interpolation: { escapeValue: false },
})

i18n.on('languageChanged', (lang) => {
  if (lang === 'cs' || lang === 'en') persistLanguage(lang)
})

export function setLanguage(lang: Language): void {
  void i18n.changeLanguage(lang)
  persistLanguage(lang)
}

export function getLanguage(): Language {
  return (i18n.language as Language) ?? 'cs'
}

export default i18n
