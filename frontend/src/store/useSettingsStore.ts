import { create } from 'zustand'

const STORAGE_KEY = 'shelfy.darkMode'

type SettingsState = {
  darkMode: boolean
  initialize: () => void
  setDarkMode: (value: boolean) => void
  toggleDarkMode: () => void
}

function applyThemeClass(isDark: boolean): void {
  const root = document.documentElement
  root.classList.toggle('dark', isDark)
  root.classList.toggle('light', !isDark)
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  darkMode: false,
  initialize: () => {
    const persisted = localStorage.getItem(STORAGE_KEY)
    const fromStorage = persisted !== null ? persisted === 'true' : null
    const preferred = fromStorage ?? window.matchMedia('(prefers-color-scheme: dark)').matches
    applyThemeClass(preferred)
    set({ darkMode: preferred })
  },
  setDarkMode: (value: boolean) => {
    localStorage.setItem(STORAGE_KEY, String(value))
    applyThemeClass(value)
    set({ darkMode: value })
  },
  toggleDarkMode: () => {
    const next = !get().darkMode
    localStorage.setItem(STORAGE_KEY, String(next))
    applyThemeClass(next)
    set({ darkMode: next })
  },
}))
