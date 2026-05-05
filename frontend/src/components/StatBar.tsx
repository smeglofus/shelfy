import { useMemo } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'

type StatFilter = 'total' | 'read' | 'reading' | 'lent'

interface Props {
  total: number
  readCount: number
  readingCount: number
  lentCount: number
  active?: StatFilter
  onSelect?: (filter: StatFilter) => void
}

export function StatBar({ total, readCount, readingCount, lentCount, active = 'total', onSelect }: Props) {
  const { t } = useTranslation()

  const stats = useMemo(
    () => [
      { key: 'total' as const, label: t('stats.total'), value: total, accent: 'var(--sh-text-main)' },
      { key: 'read' as const, label: t('stats.read'), value: readCount, accent: 'var(--sh-teal)' },
      { key: 'reading' as const, label: t('stats.reading'), value: readingCount, accent: 'var(--sh-amber, #BA7517)' },
      { key: 'lent' as const, label: t('stats.lent'), value: lentCount, accent: 'var(--sh-blue)' },
    ],
    [total, readCount, readingCount, lentCount, t],
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
            className={`sh-stat-card${isActive ? ' sh-stat-card--active' : ''}`}
            style={{ '--stat-accent': s.accent } as React.CSSProperties}
          >
            <div style={{ fontSize: 20, fontWeight: 500, color: s.accent, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 10, color: 'var(--sh-text-muted)', marginTop: 3 }}>{s.label}</div>
          </button>
        )
      })}
    </div>
  )
}
