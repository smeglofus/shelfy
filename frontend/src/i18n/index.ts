import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import cs from './cs.json'
import en from './en.json'

export type Language = 'cs' | 'en'

const STORAGE_KEY = 'shelfy.language'

function getInitialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'cs' || stored === 'en') return stored
  } catch {
    // ignore
  }
  return 'cs'
}

void i18n.use(initReactI18next).init({
  resources: { cs: { translation: cs }, en: { translation: en } },
  lng: getInitialLanguage(),
  fallbackLng: 'cs',
  interpolation: { escapeValue: false },
})

export function setLanguage(lang: Language): void {
  void i18n.changeLanguage(lang)
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // ignore
  }
}

export function getLanguage(): Language {
  return (i18n.language as Language) ?? 'cs'
}

export default i18n
