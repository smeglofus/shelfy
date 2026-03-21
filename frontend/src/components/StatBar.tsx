import type { Book } from '../lib/types'

interface Props {
  books: Book[]
  total: number
}

export function StatBar({ books, total }: Props) {
  const read    = books.filter(b => b.reading_status === 'read').length
  const reading = books.filter(b => b.reading_status === 'reading').length
  const lent    = books.filter(b => b.reading_status === 'lent').length

  const stats = [
    { label: 'Celkem', value: total, accent: '#111' },
    { label: 'Přečteno', value: read, accent: '#1D9E75' },
    { label: 'Čtu', value: reading, accent: '#BA7517' },
    { label: 'Půjčeno', value: lent, accent: '#185FA5' },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, margin: '14px 16px 0' }}>
      {stats.map(s => (
        <div key={s.label} style={{
          background: '#F7F7F5',
          borderRadius: 10,
          padding: '10px 8px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 20, fontWeight: 500, color: s.accent, lineHeight: 1 }}>{s.value}</div>
          <div style={{ fontSize: 10, color: '#888', marginTop: 3 }}>{s.label}</div>
        </div>
      ))}
    </div>
  )
}
