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

function safeReadPersistedDarkMode(): boolean | null {
  try {
    const persisted = localStorage.getItem(STORAGE_KEY)
    if (persisted === null) return null
    return persisted === 'true'
  } catch {
    return null
  }
}

function safeWritePersistedDarkMode(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    // no-op for locked-down browsers/storage
  }
}

function safeSystemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  darkMode: false,
  initialize: () => {
    const fromStorage = safeReadPersistedDarkMode()
    const preferred = fromStorage ?? safeSystemPrefersDark()
    applyThemeClass(preferred)
    set({ darkMode: preferred })
  },
  setDarkMode: (value: boolean) => {
    safeWritePersistedDarkMode(value)
    applyThemeClass(value)
    set({ darkMode: value })
  },
  toggleDarkMode: () => {
    const next = !get().darkMode
    safeWritePersistedDarkMode(next)
    applyThemeClass(next)
    set({ darkMode: next })
  },
}))
