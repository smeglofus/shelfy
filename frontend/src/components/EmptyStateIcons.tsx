/**
 * Outlined SVG icons for empty states and UI affordances.
 * All icons use stroke="currentColor" — inherit color via CSS.
 * Default size: 56px (for empty states), override via `size` prop.
 */
import type React from 'react'

interface IconProps {
  size?: number
  className?: string
  style?: React.CSSProperties
}

const base = (size: number) => ({
  width: size,
  height: size,
  display: 'block' as const,
  flexShrink: 0 as const,
})

/** Open book — empty library, no books */
export function EmptyLibraryIcon({ size = 56, className, style }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ ...base(size), ...style }}
      aria-hidden="true"
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  )
}

/** Magnifying glass with × — no search results */
export function NoResultsIcon({ size = 56, className, style }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ ...base(size), ...style }}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8.5" y1="8.5" x2="13.5" y2="13.5" />
      <line x1="13.5" y1="8.5" x2="8.5" y2="13.5" />
    </svg>
  )
}

/** Bookcase outline — empty bookshelf / no shelf data */
export function EmptyShelfIcon({ size = 56, className, style }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ ...base(size), ...style }}
      aria-hidden="true"
    >
      <rect x="2" y="3" width="20" height="18" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <line x1="2" y1="17" x2="22" y2="17" />
      <line x1="8" y1="17" x2="8" y2="21" />
      <line x1="16" y1="17" x2="16" y2="21" />
    </svg>
  )
}

/** Camera — scan / take photo */
export function CameraIcon({ size = 56, className, style }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ ...base(size), ...style }}
      aria-hidden="true"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

/** Hourglass — processing / scanning in progress */
export function ProcessingIcon({ size = 56, className, style }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ ...base(size), ...style }}
      aria-hidden="true"
    >
      <path d="M5 2h14" />
      <path d="M5 22h14" />
      <path d="M5 2c0 7 7 9 7 12s-7 5-7 12" />
      <path d="M19 2c0 7-7 9-7 12s7 5 7 12" />
    </svg>
  )
}

/** Map pin — no locations / empty locations */
export function LocationPinIcon({ size = 56, className, style }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ ...base(size), ...style }}
      aria-hidden="true"
    >
      <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

/** Small bookshelf icon for inline / nav use */
export function BookshelfInlineIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ ...base(size), ...style }}
      aria-hidden="true"
    >
      <rect x="2" y="3" width="20" height="18" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <line x1="2" y1="17" x2="22" y2="17" />
      <line x1="8" y1="17" x2="8" y2="21" />
      <line x1="16" y1="17" x2="16" y2="21" />
    </svg>
  )
}
