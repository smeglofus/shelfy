import { create } from 'zustand'

interface ToastMessage {
  id: number
  message: string
}

interface ToastState {
  message: ToastMessage | null
  showError: (message: string) => void
  clear: () => void
}

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  showError: (message: string) => set({ message: { id: Date.now(), message } }),
  clear: () => set({ message: null }),
}))
