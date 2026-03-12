import { useEffect } from 'react'

import { useToastStore } from '../lib/toast-store'

export function ErrorToast() {
  const message = useToastStore((state) => state.message)
  const clear = useToastStore((state) => state.clear)

  useEffect(() => {
    if (!message) {
      return
    }

    const timeout = window.setTimeout(() => clear(), 3000)
    return () => window.clearTimeout(timeout)
  }, [clear, message])

  if (!message) {
    return null
  }

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: '1rem',
        right: '1rem',
        background: '#ef4444',
        color: 'white',
        padding: '0.75rem 1rem',
        borderRadius: '0.5rem',
      }}
    >
      {message}
    </div>
  )
}
