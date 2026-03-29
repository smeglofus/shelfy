import { useEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  /** aria-label for the dialog */
  label: string
  /** Max width of the modal panel (default: 480) */
  maxWidth?: number
}

/**
 * Accessible modal dialog with:
 * - Focus trap (Tab cycles within modal)
 * - Escape to close
 * - Backdrop click to close
 * - Auto-focus first focusable element
 * - Returns focus to trigger on close
 * - aria-modal, role="dialog"
 * - Entry animation
 */
export function Modal({ open, onClose, children, label, maxWidth = 480 }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<Element | null>(null)

  /* Save the trigger element when opening */
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement
    }
  }, [open])

  /* Auto-focus first focusable element inside modal */
  useEffect(() => {
    if (!open || !panelRef.current) return

    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    const first = focusable[0]
    if (first) {
      // Small delay to let animation start
      requestAnimationFrame(() => first.focus())
    }
  }, [open])

  /* Escape key to close */
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  /* Focus trap */
  useEffect(() => {
    if (!open || !panelRef.current) return

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const focusable = panelRef.current!.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  /* Restore focus on close */
  useEffect(() => {
    if (!open && triggerRef.current && triggerRef.current instanceof HTMLElement) {
      triggerRef.current.focus()
      triggerRef.current = null
    }
  }, [open])

  /* Prevent body scroll when open */
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [open])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={(e) => {
        // Close on backdrop click (not bubble from panel)
        if (e.target === overlayRef.current) onClose()
      }}
      className="sh-modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        padding: '16px',
      }}
    >
      <div
        ref={panelRef}
        className="sh-modal-panel"
        style={{
          background: 'var(--sh-surface)',
          borderRadius: 'var(--sh-radius-xl)',
          padding: 24,
          width: '100%',
          maxWidth,
          maxHeight: 'calc(100dvh - 32px)',
          overflowY: 'auto',
          boxShadow: 'var(--sh-shadow-lg)',
          border: '1px solid var(--sh-border)',
        }}
      >
        {children}
      </div>
    </div>
  )
}
