import { useEffect, useRef } from 'react'

import { type ToastMessage, type ToastVariant, useToastStore } from '../lib/toast-store'

const TOAST_DURATIONS: Record<ToastVariant, number> = {
  error: 6000,
  warning: 5000,
  success: 3000,
  info: 3500,
}

const variantConfig: Record<ToastVariant, { bg: string; border: string; color: string; icon: string }> = {
  success: {
    bg: 'var(--sh-teal-bg)',
    border: 'var(--sh-teal)',
    color: 'var(--sh-teal-text)',
    icon: '✓',
  },
  error: {
    bg: 'var(--sh-red-bg)',
    border: 'var(--sh-red)',
    color: 'var(--sh-red-text)',
    icon: '✕',
  },
  warning: {
    bg: 'var(--sh-amber-bg)',
    border: 'var(--sh-amber)',
    color: 'var(--sh-amber-text)',
    icon: '!',
  },
  info: {
    bg: 'var(--sh-blue-bg)',
    border: 'var(--sh-blue)',
    color: 'var(--sh-blue-text)',
    icon: 'i',
  },
}

function ToastItem({ toast }: { toast: ToastMessage }) {
  const dismiss = useToastStore((s) => s.dismiss)
  const ref = useRef<HTMLDivElement>(null)
  const config = variantConfig[toast.variant]

  const duration = TOAST_DURATIONS[toast.variant]

  useEffect(() => {
    const timeout = window.setTimeout(() => dismiss(toast.id), duration)
    return () => window.clearTimeout(timeout)
  }, [dismiss, toast.id, duration])

  return (
    <div
      ref={ref}
      role="alert"
      className="sh-toast-item"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '14px 16px',
        background: config.bg,
        border: `1.5px solid ${config.border}`,
        borderRadius: 'var(--sh-radius-md)',
        color: config.color,
        boxShadow: 'var(--sh-shadow-md)',
        minWidth: 280,
        maxWidth: 420,
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Icon */}
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: config.border,
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {config.icon}
      </span>

      {/* Message */}
      <span
        style={{
          flex: 1,
          fontSize: 14,
          fontWeight: 500,
          lineHeight: 1.4,
          paddingTop: 2,
        }}
      >
        {toast.message}
      </span>

      {/* Dismiss button */}
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: config.color,
          opacity: 0.6,
          fontSize: 16,
          lineHeight: 1,
          padding: 4,
          flexShrink: 0,
          marginTop: -2,
        }}
      >
        ✕
      </button>

      {/* Progress bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: 3,
          width: '100%',
          background: config.border,
          opacity: 0.4,
          borderRadius: '0 0 var(--sh-radius-md) var(--sh-radius-md)',
          animation: `sh-toast-progress ${duration}ms linear forwards`,
        }}
      />
    </div>
  )
}

export function Toast() {
  const toasts = useToastStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        left: 16,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <div key={toast.id} style={{ pointerEvents: 'auto' }}>
          <ToastItem toast={toast} />
        </div>
      ))}
    </div>
  )
}
