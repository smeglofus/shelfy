import { useTranslation } from 'react-i18next'

import type { ReadingStatus } from '../lib/types'

interface Props {
  status: ReadingStatus
  lentTo?: string | null
}

const COLOR_CONFIG: Record<ReadingStatus, { bg: string; color: string }> = {
  read: { bg: 'var(--sh-teal-bg)', color: 'var(--sh-teal-text)' },
  reading: { bg: 'var(--sh-amber-bg)', color: 'var(--sh-amber-text)' },
  lent: { bg: 'var(--sh-blue-bg)', color: 'var(--sh-blue-text)' },
  unread: { bg: 'var(--sh-surface-elevated)', color: 'var(--sh-text-muted)' },
}

export function ReadingStatusBadge({ status, lentTo }: Props) {
  const { t } = useTranslation()
  const { bg, color } = COLOR_CONFIG[status]
  const label = t(`reading_status.${status}`)
  const text = status === 'lent' && lentTo ? t('reading_status.lent_to', { name: lentTo }) : label

  return (
    <span
      style={{
        fontSize: 11,
        padding: '4px 10px',
        borderRadius: 'var(--sh-radius-pill)',
        background: bg,
        color,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        letterSpacing: '0.02em',
      }}
    >
      {text}
    </span>
  )
}
