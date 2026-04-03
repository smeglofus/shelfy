import { create } from 'zustand'

import { ACTIVE_LIBRARY_ID_KEY } from '../lib/api'

type LibraryState = {
  activeLibraryId: string | null
  setActiveLibraryId: (id: string | null) => void
}

function safeRead(): string | null {
  try {
    return localStorage.getItem(ACTIVE_LIBRARY_ID_KEY)
  } catch {
    return null
  }
}

function safeWrite(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(ACTIVE_LIBRARY_ID_KEY, id)
    } else {
      localStorage.removeItem(ACTIVE_LIBRARY_ID_KEY)
    }
  } catch {
    // locked-down storage
  }
}

export const useLibraryStore = create<LibraryState>((set) => ({
  activeLibraryId: safeRead(),
  setActiveLibraryId: (id) => {
    safeWrite(id)
    set({ activeLibraryId: id })
  },
}))
