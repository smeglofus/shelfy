import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { Book } from '../lib/types'

interface Props {
  books: Book[]
  total: number
}

export function StatBar({ books, total }: Props) {
  const { t } = useTranslation()
  const read = books.filter((b) => b.reading_status === 'read').length
  const reading = books.filter((b) => b.reading_status === 'reading').length
  const lent = books.filter((b) => b.reading_status === 'lent').length

  const stats = useMemo(
    () => [
      { label: t('stats.total'), value: total, accent: 'var(--sh-text-main)' },
      { label: t('stats.read'), value: read, accent: 'var(--sh-teal)' },
      { label: t('stats.reading'), value: reading, accent: 'var(--sh-amber, #BA7517)' },
      { label: t('stats.lent'), value: lent, accent: 'var(--sh-blue)' },
    ],
    [lent, read, reading, t, total],
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, margin: '14px 16px 0' }}>
      {stats.map((s) => (
        <div
          key={s.label}
          style={{
            background: 'var(--sh-surface-elevated)',
            borderRadius: 10,
            padding: '10px 8px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 500, color: s.accent, lineHeight: 1 }}>{s.value}</div>
          <div style={{ fontSize: 10, color: 'var(--sh-text-muted)', marginTop: 3 }}>{s.label}</div>
        </div>
      ))}
    </div>
  )
}
