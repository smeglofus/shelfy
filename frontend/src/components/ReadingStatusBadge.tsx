import type { ReadingStatus } from '../lib/types'

interface Props {
  status: ReadingStatus
  lentTo?: string | null
}

const CONFIG: Record<ReadingStatus, { label: string; bg: string; color: string }> = {
  read:    { label: 'Přečteno',  bg: '#E1F5EE', color: '#085041' },
  reading: { label: 'Čtu',       bg: '#FAEEDA', color: '#633806' },
  lent:    { label: 'Půjčeno',   bg: '#E6F1FB', color: '#042C53' },
  unread:  { label: 'Nepřečteno',bg: '#F1EFE8', color: '#5F5E5A' },
}

export function ReadingStatusBadge({ status, lentTo }: Props) {
  const { bg, color, label } = CONFIG[status]
  const text = status === 'lent' && lentTo ? `Půjčeno · ${lentTo}` : label

  return (
    <span style={{
      fontSize: 10,
      padding: '2px 8px',
      borderRadius: 4,
      background: bg,
      color,
      fontWeight: 500,
      whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  )
}
