import { create } from 'zustand'

import type { QuotaErrorDetail } from '../lib/types'

interface UpgradeState {
  isOpen: boolean
  detail: QuotaErrorDetail | null
  show: (detail: QuotaErrorDetail) => void
  hide: () => void
}

export const useUpgradeStore = create<UpgradeState>((set) => ({
  isOpen: false,
  detail: null,
  show: (detail) => set({ isOpen: true, detail }),
  hide: () => set({ isOpen: false, detail: null }),
}))
