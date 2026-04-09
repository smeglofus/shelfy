import { type ReactNode, useState } from 'react'

interface AccordionSectionProps {
  title: string
  defaultOpen?: boolean
  badge?: ReactNode
  onToggle?: (isOpen: boolean) => void
  children: ReactNode
}

export function AccordionSection({ title, defaultOpen = true, badge, onToggle, children }: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div style={{ borderBottom: '1px solid var(--sh-border)' }}>
      <button
        type="button"
        onClick={() =>
          setOpen((v) => {
            const next = !v
            onToggle?.(next)
            return next
          })
        }
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 0',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontFamily: "'Outfit', sans-serif",
          minHeight: 44,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--sh-text-main)', letterSpacing: '-0.02em' }}>
            {title}
          </span>
          {badge}
        </span>
        <span
          className="sh-accordion-chevron"
          style={{
            fontSize: 14,
            color: 'var(--sh-text-muted)',
            transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </span>
      </button>
      <div
        className="sh-accordion-body"
        style={{
          overflow: 'hidden',
          maxHeight: open ? 2000 : 0,
          opacity: open ? 1 : 0,
          transition: 'max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease',
        }}
      >
        <div style={{ paddingBottom: 20 }}>
          {children}
        </div>
      </div>
    </div>
  )
}
