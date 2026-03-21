import type { Location } from '../lib/types'

interface Props {
  location: Location
}

export function ShelfBreadcrumb({ location }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10 }}>
      <span style={{ fontSize: 11, color: '#888' }}>{location.room}</span>
      <span style={{ fontSize: 11, color: '#ccc' }}>›</span>
      <span style={{ fontSize: 11, color: '#888' }}>{location.furniture}</span>
      <span style={{ fontSize: 11, color: '#ccc' }}>›</span>
      <span style={{
        fontSize: 11,
        fontWeight: 500,
        color: '#0F6E56',
        background: '#E1F5EE',
        padding: '2px 8px',
        borderRadius: 4,
      }}>
        {location.shelf}
      </span>
    </div>
  )
}
