import { useTranslation } from 'react-i18next'
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
  /** Index in the grid, used for staggered entrance animation */
  index?: number
  highlighted?: boolean
}

export function BookCard({ book, onDelete, index = 0, highlighted = false }: Props) {
  const { t } = useTranslation()
  const [from, to] = GRADIENTS[hashTitle(book.title) % GRADIENTS.length]

  return (
    <div style={{ position: "relative", animationDelay: `${Math.min(index * 40, 400)}ms` }} className="hover-scale sh-card-enter">
      {onDelete && (
        <button
          className="sh-card-delete-btn"
          aria-label={`delete-${book.id}`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete(book.id)
          }}
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            zIndex: 2,
            border: "1px solid var(--sh-border-2)",
            borderRadius: "var(--sh-radius-pill)",
            width: 26,
            height: 26,
            cursor: "pointer",
            background: "var(--sh-surface)",
            color: "var(--sh-text-muted)",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            boxShadow: "var(--sh-shadow-xs)",
            opacity: 0,
            transition: "opacity 0.15s ease, transform 0.15s ease",
          }}
          title={t('books.delete_title')}
        >
          ×
        </button>
      )}
      <Link
        to={getBookDetailRoute(book.id)}
        style={{
          background: 'var(--sh-surface)',
          borderRadius: 'var(--sh-radius-lg)',
          border: highlighted ? '2px solid var(--sh-teal)' : '1px solid var(--sh-border)',
          overflow: 'hidden',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: highlighted ? '0 0 0 4px var(--sh-border-focus), var(--sh-shadow-sm)' : 'var(--sh-shadow-sm)',
        }}
      >
        {/* Cover */}
        <div style={{
          height: 140,
          background: `linear-gradient(135deg, ${from}, ${to})`,
          position: 'relative',
          padding: book.cover_image_url ? 0 : 16,
          display: 'flex',
          alignItems: 'flex-end',
          overflow: 'hidden',
        }}>
          {book.cover_image_url ? (
            <img
              src={book.cover_image_url}
              alt={book.title}
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <>
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
            </>
          )}
        </div>

        {/* Info */}
        <div style={{ padding: 12, flex: 1, display: 'flex', flexDirection: 'column' }}>
          {book.author && (
            <p style={{ fontSize: 12, color: 'var(--sh-text-muted)', marginBottom: 2, fontWeight: 500 }}>
              {book.author}
            </p>
          )}
          <p style={{
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.35,
            marginBottom: 10,
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
            <ReadingStatusBadge status={book.reading_status ?? 'unread'} />
            {book.is_currently_lent && (
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 'var(--sh-radius-pill)', fontSize: 12, fontWeight: 600, background: 'var(--sh-amber-bg)', color: 'var(--sh-amber)' }}>
                Lent
              </span>
            )}
          </div>
        </div>
      </Link>
    </div>
  )
}
