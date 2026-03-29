import { type CSSProperties } from 'react'

interface SkeletonProps {
  width?: string | number
  height?: string | number
  borderRadius?: string | number
  style?: CSSProperties
  className?: string
}

export function Skeleton({ width = '100%', height = 16, borderRadius = 'var(--sh-radius-sm)', style, className }: SkeletonProps) {
  return (
    <div
      className={`sh-skeleton ${className ?? ''}`}
      aria-hidden="true"
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  )
}

/** A row of skeleton lines for text blocks */
export function SkeletonText({ lines = 3, gap = 8 }: { lines?: number; gap?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height={14}
          width={i === lines - 1 ? '60%' : '100%'}
        />
      ))}
    </div>
  )
}

/** Skeleton for a single book card */
export function SkeletonBookCard() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Skeleton height={200} borderRadius="var(--sh-radius-md)" />
      <Skeleton height={14} width="80%" />
      <Skeleton height={12} width="50%" />
    </div>
  )
}

/** Skeleton for a book grid (e.g. BooksPage) */
export function SkeletonBookGrid({ count = 8 }: { count?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBookCard key={i} />
      ))}
    </div>
  )
}

/** Skeleton for a location row on HomePage */
export function SkeletonLocationRow() {
  return (
    <div
      style={{
        background: 'var(--sh-surface)',
        border: '1px solid var(--sh-border)',
        borderRadius: 'var(--sh-radius-md)',
        padding: 16,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <Skeleton width="55%" height={16} />
      <Skeleton width={48} height={28} borderRadius="var(--sh-radius-pill)" />
    </div>
  )
}

/** Skeleton for a recently added book item on HomePage */
export function SkeletonRecentBook() {
  return (
    <div
      style={{
        background: 'var(--sh-surface)',
        border: '1px solid var(--sh-border)',
        borderRadius: 'var(--sh-radius-md)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <Skeleton width="70%" height={16} />
      <Skeleton width="40%" height={13} />
    </div>
  )
}

/** Full skeleton for BookDetailPage */
export function SkeletonBookDetail() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Cover area */}
      <Skeleton height={240} borderRadius="var(--sh-radius-xl)" />
      {/* Title + Author */}
      <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skeleton width="65%" height={28} />
        <Skeleton width="35%" height={18} />
      </div>
      {/* Metadata rows */}
      <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Skeleton width={100} height={14} />
            <Skeleton width="60%" height={14} />
          </div>
        ))}
      </div>
      {/* Description */}
      <div style={{ padding: '0 24px' }}>
        <SkeletonText lines={4} />
      </div>
    </div>
  )
}

/** Skeleton for locations table rows */
export function SkeletonLocationTableRow() {
  return (
    <tr style={{ borderBottom: '1px solid var(--sh-border)' }}>
      <td style={{ padding: 16 }}><Skeleton width="70%" height={14} /></td>
      <td style={{ padding: 16 }}><Skeleton width="60%" height={14} /></td>
      <td style={{ padding: 16 }}><Skeleton width="50%" height={14} /></td>
      <td style={{ padding: 16, textAlign: 'right' }}><Skeleton width={80} height={14} style={{ marginLeft: 'auto' }} /></td>
    </tr>
  )
}
