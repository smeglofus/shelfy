import { Link } from 'react-router-dom'
import type { Book } from '../lib/types'
import { ReadingStatusBadge } from './ReadingStatusBadge'
import { getBookDetailRoute } from '../lib/routes'

const GRADIENTS: [string, string][] = [
  ['#1D9E75', '#085041'],
  ['#BA7517', '#633806'],
  ['#534AB7', '#26215C'],
  ['#185FA5', '#042C53'],
  ['#639922', '#173404'],
  ['#993556', '#4B1528'],
]

function hashTitle(title: string): number {
  let h = 0
  for (const ch of title) h = ((h << 5) - h + ch.charCodeAt(0)) | 0
  return Math.abs(h)
}

interface Props {
  book: Book
  onDelete?: (bookId: string) => void
}

export function BookCard({ book, onDelete }: Props) {
  const [from, to] = GRADIENTS[hashTitle(book.title) % GRADIENTS.length]

  return (
    <div style={{ position: "relative" }}>
      {onDelete && (
        <button
          aria-label={`delete-${book.id}`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete(book.id)
          }}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 2,
            border: "none",
            borderRadius: 999,
            width: 24,
            height: 24,
            cursor: "pointer",
            background: "rgba(0,0,0,0.55)",
            color: "white",
            fontSize: 14,
            lineHeight: "24px",
            padding: 0,
          }}
          title="Smazat knihu"
        >
          ×
        </button>
      )}
      <Link
      to={getBookDetailRoute(book.id)}
      style={{
        background: 'white',
        borderRadius: 14,
        border: '0.5px solid rgba(0,0,0,0.10)',
        overflow: 'hidden',
        display: 'block',
        transition: 'border-color 0.15s',
      }}
    >
      {/* Cover */}
      <div style={{
        height: 130,
        background: `linear-gradient(135deg, ${from}, ${to})`,
        display: 'flex',
        alignItems: 'flex-end',
        padding: 10,
      }}>
        <span style={{
          fontSize: 11,
          fontWeight: 500,
          color: 'white',
          lineHeight: 1.3,
          textShadow: '0 1px 3px rgba(0,0,0,0.4)',
        }}>
          {book.title}
        </span>
      </div>

      {/* Info */}
      <div style={{ padding: 10 }}>
        {book.author && (
          <p style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{book.author}</p>
        )}
        <p style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3, marginBottom: 6 }}>
          {book.title}
        </p>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <ReadingStatusBadge
            status={book.reading_status ?? 'unread'}
            lentTo={book.lent_to}
          />
        </div>
      </div>
    </Link>
    </div>
  )
}
