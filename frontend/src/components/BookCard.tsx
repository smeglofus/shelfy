import type React from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { Book } from '../lib/types'
import { ReadingStatusBadge } from './ReadingStatusBadge'
import { getBookDetailRoute } from '../lib/routes'
import { useIsDemoMode } from '../features/demo/DemoContext'

// ── Cover palette: [bgColor, accentColor] ────────────────────────────
// Replaces the old GRADIENTS array. Each palette has a dark background
// and a vivid accent used for the top stripe.
const COVER_PALETTES: [string, string][] = [
  ['#0E3D2B', '#2D7A5F'],
  ['#5C3A00', '#F4B400'],
  ['#1A1F5E', '#4285F4'],
  ['#5B1A1A', '#DB4437'],
  ['#2D1458', '#9b51e0'],
  ['#1A3A4A', '#639922'],
]

function hashTitle(title: string): number {
  let h = 0
  for (const ch of title) h = ((h << 5) - h + ch.charCodeAt(0)) | 0
  return Math.abs(h)
}

/** Extract up to 2 uppercase initials from an author name. */
function getInitials(author: string | null | undefined): string {
  if (!author) return '?'
  return author
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join('')
}

// ── SVG cover patterns ────────────────────────────────────────────────
// Six distinct geometric patterns rendered as SVG. The pattern index is
// derived from the title hash so each book gets a consistent pattern.

function CoverPattern({ index }: { index: number }): React.ReactElement {
  const id = `cp-${index}`
  const w = 200
  const h = 140

  const patterns: React.ReactElement[] = [
    // 0: diagonal hatch
    <svg key={0} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.18 }} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id={id} x={0} y={0} width={12} height={12} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={12} stroke="white" strokeWidth={1.5} />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#${id})`} />
    </svg>,

    // 1: concentric circles
    <svg key={1} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.18 }} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice">
      {[20, 38, 58, 80, 106].map((r, i) => (
        <circle key={i} cx={w / 2} cy={h * 0.38} r={r} fill="none" stroke="white" strokeWidth={1.5} />
      ))}
    </svg>,

    // 2: dot grid
    <svg key={2} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.2 }} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id={id} x={0} y={0} width={10} height={10} patternUnits="userSpaceOnUse">
          <circle cx={5} cy={5} r={1.5} fill="white" />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#${id})`} />
    </svg>,

    // 3: horizontal rules
    <svg key={3} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.15 }} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id={id} x={0} y={0} width={w} height={8} patternUnits="userSpaceOnUse">
          <line x1={0} y1={7.5} x2={w} y2={7.5} stroke="white" strokeWidth={1} />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#${id})`} />
    </svg>,

    // 4: diamond grid
    <svg key={4} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.15 }} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id={id} x={0} y={0} width={16} height={16} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect x={0} y={0} width={16} height={16} fill="none" stroke="white" strokeWidth={1} />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#${id})`} />
    </svg>,

    // 5: cross grid
    <svg key={5} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.15 }} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id={id} x={0} y={0} width={14} height={14} patternUnits="userSpaceOnUse">
          <line x1={0} y1={7} x2={14} y2={7} stroke="white" strokeWidth={1} />
          <line x1={7} y1={0} x2={7} y2={14} stroke="white" strokeWidth={1} />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#${id})`} />
    </svg>,
  ]

  return patterns[index % patterns.length]
}

// ── Props (unchanged from original) ──────────────────────────────────
interface Props {
  book: Book
  onDelete?: (bookId: string) => void
  /** Index in the grid, used for staggered entrance animation */
  index?: number
  highlighted?: boolean
  /** Multi-select mode */
  selectable?: boolean
  selected?: boolean
  onSelect?: (bookId: string) => void
}

export function BookCard({
  book,
  onDelete,
  index = 0,
  highlighted = false,
  selectable = false,
  selected = false,
  onSelect,
}: Props) {
  const { t } = useTranslation()
  // The demo has no book-detail route, so cards there are non-navigating. (#285)
  const isDemo = useIsDemoMode()

  const hash = hashTitle(book.title)
  const [bgColor, accentColor] = COVER_PALETTES[hash % COVER_PALETTES.length]
  const patternIndex = hash % 6
  const initials = getInitials(book.author)

  const handleClick = (e: React.MouseEvent) => {
    if (selectable && onSelect) {
      e.preventDefault()
      onSelect(book.id)
    }
  }

  const cardContent = (
    <>
      {/* ── Cover ─────────────────────────────────────────────────── */}
      <div
        style={{
          height: 140,
          background: book.cover_image_url ? undefined : bgColor,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          padding: book.cover_image_url ? 0 : 10,
          overflow: 'hidden',
        }}
      >
        {book.cover_image_url ? (
          // Real cover image — shown as-is, no pattern overlay
          <img
            src={book.cover_image_url}
            alt={book.title}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <>
            {/* SVG background pattern */}
            <CoverPattern index={patternIndex} />

            {/* Accent stripe at top */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 4,
                background: accentColor,
                zIndex: 2,
              }}
            />

            {/* Author initials bubble — top right */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                zIndex: 3,
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.18)',
                border: '1.5px solid rgba(255,255,255,0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 700,
                color: 'white',
                letterSpacing: '0.02em',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
              }}
            >
              {initials}
            </div>

            {/* Gradient overlay for legible title text */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0) 60%)',
                zIndex: 1,
                pointerEvents: 'none',
              }}
            />

            {/* Book title */}
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'white',
                lineHeight: 1.3,
                position: 'relative',
                zIndex: 2,
                textShadow: '0 1px 5px rgba(0,0,0,0.5)',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {book.title}
            </span>
          </>
        )}
      </div>

      {/* ── Info ──────────────────────────────────────────────────── */}
      <div style={{ padding: 12, flex: 1, display: 'flex', flexDirection: 'column' }}>
        {book.author && (
          <p style={{ fontSize: 12, color: 'var(--sh-text-muted)', marginBottom: 2, fontWeight: 500 }}>
            {book.author}
          </p>
        )}
        <p
          style={{
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
          }}
        >
          {book.title}
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
          <ReadingStatusBadge status={book.reading_status ?? 'unread'} />
          {book.is_currently_lent && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 8px',
                borderRadius: 'var(--sh-radius-pill)',
                fontSize: 12,
                fontWeight: 600,
                background: 'var(--sh-amber-bg)',
                color: 'var(--sh-amber)',
              }}
            >
              Lent
            </span>
          )}
        </div>
      </div>
    </>
  )

  return (
    <div
      style={{ position: 'relative', animationDelay: `${Math.min(index * 40, 400)}ms` }}
      className={`sh-card-enter${selectable ? ' sh-book-card-selectable' : ' hover-scale'}${selected ? ' sh-book-card-selected' : ''}`}
      onClick={handleClick}
    >
      {/* Selection checkmark (visible in select mode) */}
      {selectable && (
        <div className="sh-book-card-check" aria-hidden="true">
          {selected && (
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="2,6 5,9 10,3" />
            </svg>
          )}
        </div>
      )}

      {/* Delete button (only in normal mode) */}
      {!selectable && onDelete && (
        <button
          className="sh-card-delete-btn"
          aria-label={`delete-${book.id}`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete(book.id)
          }}
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            zIndex: 2,
            border: '1px solid var(--sh-border-2)',
            borderRadius: 'var(--sh-radius-pill)',
            width: 26,
            height: 26,
            cursor: 'pointer',
            background: 'var(--sh-surface)',
            color: 'var(--sh-text-muted)',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            boxShadow: 'var(--sh-shadow-xs)',
            opacity: 0,
            transition: 'opacity 0.15s ease, transform 0.15s ease',
          }}
          title={t('books.delete_title')}
        >
          ×
        </button>
      )}

      {selectable || isDemo ? (
        <div
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
          {cardContent}
        </div>
      ) : (
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
          {cardContent}
        </Link>
      )}
    </div>
  )
}
