import { Link } from 'react-router-dom'
import type { Book } from '../lib/types'
import { ReadingStatusBadge } from './ReadingStatusBadge'
import { getBookDetailRoute } from '../lib/routes'

const GRADIENTS: [string, string][] = [
  ['#1D9E75', '#085041'],
  ['#F4B400', '#7a5a00'],
  ['#9b51e0', '#41156d'],
  ['#4285F4', '#174ea6'],
  ['#639922', '#173404'],
  ['#DB4437', '#7C1004'],
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
    <div style={{ position: "relative" }} className="hover-scale">
      {onDelete && (
        <button
          className="hover-lift"
          aria-label={`delete-${book.id}`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete(book.id)
          }}
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            zIndex: 2,
            border: "1px solid rgba(255,255,255,0.8)",
            borderRadius: "var(--sh-radius-pill)",
            width: 28,
            height: 28,
            cursor: "pointer",
            background: "var(--sh-surface)",
            color: "var(--sh-text-muted)",
            fontSize: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            boxShadow: "var(--sh-shadow-sm)",
            transition: "all 0.2s ease"
          }}
          title="Smazat knihu"
        >
          ×
        </button>
      )}
      <Link
        to={getBookDetailRoute(book.id)}
        style={{
          background: 'var(--sh-surface)',
          borderRadius: 'var(--sh-radius-lg)',
          border: '1px solid var(--sh-border)',
          overflow: 'hidden',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--sh-shadow-sm)',
        }}
      >
        {/* Cover */}
        <div style={{
          height: 140,
          background: `linear-gradient(135deg, ${from}, ${to})`,
          position: 'relative',
          padding: 16,
          display: 'flex',
          alignItems: 'flex-end',
        }}>
          {/* Subtle overlay for depth */}
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 100%)',
            pointerEvents: 'none',
          }} />
          <span style={{
            fontSize: 14,
            fontWeight: 700,
            color: 'white',
            lineHeight: 1.3,
            position: 'relative',
            zIndex: 1,
            textShadow: '0 2px 4px rgba(0,0,0,0.5)',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {book.title}
          </span>
        </div>

        {/* Info */}
        <div style={{ padding: 14, flex: 1, display: 'flex', flexDirection: 'column' }}>
          {book.author && (
            <p style={{ fontSize: 13, color: 'var(--sh-text-muted)', marginBottom: 4, fontWeight: 500 }}>
              {book.author}
            </p>
          )}
          <p style={{ 
            fontSize: 15, 
            fontWeight: 600, 
            lineHeight: 1.4, 
            marginBottom: 12,
            color: 'var(--sh-text-main)',
            flex: 1,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {book.title}
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
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
