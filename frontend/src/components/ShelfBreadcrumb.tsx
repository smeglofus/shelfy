import type { Location } from '../lib/types'

interface Props {
  location: Location
}

export function ShelfBreadcrumb({ location }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10 }}>
      <span style={{ fontSize: 11, color: 'var(--sh-text-muted)' }}>{location.room}</span>
      <span style={{ fontSize: 11, color: 'var(--sh-text-muted)', opacity: 0.5 }}>›</span>
      <span style={{ fontSize: 11, color: 'var(--sh-text-muted)' }}>{location.furniture}</span>
      <span style={{ fontSize: 11, color: 'var(--sh-text-muted)', opacity: 0.5 }}>›</span>
      <span style={{
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--sh-teal-text)',
        background: 'var(--sh-teal-bg)',
        padding: '2px 8px',
        borderRadius: 4,
      }}>
        {location.shelf}
      </span>
    </div>
  )
}
