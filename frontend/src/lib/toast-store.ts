import { create } from 'zustand'

export type ToastVariant = 'error' | 'success' | 'info' | 'warning'

export interface ToastMessage {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastState {
  toasts: ToastMessage[]
  showError: (message: string) => void
  showSuccess: (message: string) => void
  showInfo: (message: string) => void
  showWarning: (message: string) => void
  dismiss: (id: number) => void
  /** @deprecated Use toasts array instead */
  message: ToastMessage | null
  clear: () => void
}

let nextId = 1
const MAX_TOASTS = 3

function addToast(set: (fn: (state: ToastState) => Partial<ToastState>) => void, message: string, variant: ToastVariant) {
  const id = nextId++
  set((state) => {
    const existing = state.toasts.find((t) => t.message === message && t.variant === variant)
    const nextToasts = existing
      ? [...state.toasts.filter((t) => t.id !== existing.id), { id, message, variant }]
      : [...state.toasts, { id, message, variant }]

    return {
      toasts: nextToasts.slice(-MAX_TOASTS),
      message: { id, message, variant },
    }
  })
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  message: null,

  showError: (message: string) => addToast(set, message, 'error'),
  showSuccess: (message: string) => addToast(set, message, 'success'),
  showInfo: (message: string) => addToast(set, message, 'info'),
  showWarning: (message: string) => addToast(set, message, 'warning'),

  dismiss: (id: number) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  clear: () => set({ toasts: [], message: null }),
}))
