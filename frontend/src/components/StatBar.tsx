import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { Book } from '../lib/types'

type StatFilter = 'total' | 'read' | 'reading' | 'lent'

interface Props {
  books: Book[]
  total: number
  active?: StatFilter
  onSelect?: (filter: StatFilter) => void
}

export function StatBar({ books, total, active = 'total', onSelect }: Props) {
  const { t } = useTranslation()
  const read = books.filter((b) => b.reading_status === 'read').length
  const reading = books.filter((b) => b.reading_status === 'reading').length
  const lent = books.filter((b) => b.is_currently_lent).length

  const stats = useMemo(
    () => [
      { key: 'total' as const, label: t('stats.total'), value: total, accent: 'var(--sh-text-main)' },
      { key: 'read' as const, label: t('stats.read'), value: read, accent: 'var(--sh-teal)' },
      { key: 'reading' as const, label: t('stats.reading'), value: reading, accent: 'var(--sh-amber, #BA7517)' },
      { key: 'lent' as const, label: t('stats.lent'), value: lent, accent: 'var(--sh-blue)' },
    ],
    [lent, read, reading, t, total],
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, margin: '14px 16px 0' }}>
      {stats.map((s) => {
        const isActive = active === s.key
        return (
        <button
          type="button"
          key={s.label}
          onClick={() => onSelect?.(s.key)}
          style={{
            background: isActive ? 'var(--sh-teal-bg)' : 'var(--sh-surface-elevated)',
            borderRadius: 10,
            border: isActive ? '1px solid var(--sh-teal)' : '1px solid var(--sh-border)',
            padding: '10px 8px',
            textAlign: 'center',
            cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 500, color: s.accent, lineHeight: 1 }}>{s.value}</div>
          <div style={{ fontSize: 10, color: 'var(--sh-text-muted)', marginTop: 3 }}>{s.label}</div>
        </button>
      )})}
    </div>
  )
}
