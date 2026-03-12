import { create } from 'zustand'

interface ToastState {
  message: string | null
  showError: (message: string) => void
  clear: () => void
}

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  showError: (message: string) => set({ message }),
  clear: () => set({ message: null }),
}))
