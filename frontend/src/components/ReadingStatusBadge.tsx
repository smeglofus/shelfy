import type { ReadingStatus } from '../lib/types'

interface Props {
  status: ReadingStatus
  lentTo?: string | null
}

const CONFIG: Record<ReadingStatus, { label: string; bg: string; color: string }> = {
  read:    { label: 'Přečteno',  bg: 'var(--sh-teal-bg)', color: 'var(--sh-teal-text)' },
  reading: { label: 'Čtu',       bg: 'var(--sh-amber-bg)', color: 'var(--sh-amber-text)' },
  lent:    { label: 'Půjčeno',   bg: 'var(--sh-blue-bg)', color: 'var(--sh-blue-text)' },
  unread:  { label: 'Nepřečteno',bg: '#F5F6F8', color: 'var(--sh-text-muted)' },
}

export function ReadingStatusBadge({ status, lentTo }: Props) {
  const { bg, color, label } = CONFIG[status]
  const text = status === 'lent' && lentTo ? `Půjčeno · ${lentTo}` : label

  return (
    <span style={{
      fontSize: 11,
      padding: '4px 10px',
      borderRadius: 'var(--sh-radius-pill)',
      background: bg,
      color,
      fontWeight: 600,
      whiteSpace: 'nowrap',
      letterSpacing: '0.02em',
    }}>
      {text}
    </span>
  )
}
