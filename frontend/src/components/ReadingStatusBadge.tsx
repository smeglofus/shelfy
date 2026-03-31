import { useTranslation } from 'react-i18next'

import type { ReadingStatus } from '../lib/types'

interface Props {
  status: ReadingStatus
}

const COLOR_CONFIG: Record<ReadingStatus, { bg: string; color: string }> = {
  read: { bg: 'var(--sh-teal-bg)', color: 'var(--sh-teal-text)' },
  reading: { bg: 'var(--sh-amber-bg)', color: 'var(--sh-amber-text)' },
  unread: { bg: 'var(--sh-surface-elevated)', color: 'var(--sh-text-muted)' },
  lent: { bg: 'var(--sh-purple-bg)', color: 'var(--sh-purple-text)' },
}

export function ReadingStatusBadge({ status }: Props) {
  const { t } = useTranslation()
  const { bg, color } = COLOR_CONFIG[status]

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
      {t(`reading_status.${status}`)}
    </span>
  )
}
