/**
 * DemoShelfPhoto — a lightweight inline SVG that stands in for a real shelf
 * photo in the scripted demo scan (#286).
 *
 * We deliberately avoid bundling binary JPG/WEBP assets: the PWA precache
 * (`vite.config.ts` workbox `globPatterns`) excludes those formats, and a real
 * photo would imply an upload that the demo must never perform. An inline SVG
 * of colourful book spines reads clearly as "a shelf of books", stays text-only
 * (no network, no precache concern), and scales crisply.
 */
interface DemoShelfPhotoProps {
  /** Base hue (degrees) so each sample photo looks distinct. */
  hue?: number
  /** Number of spines to draw. */
  spines?: number
}

export function DemoShelfPhoto({ hue = 175, spines = 9 }: DemoShelfPhotoProps) {
  const width = 240
  const height = 150
  const padding = 10
  const usable = width - padding * 2
  const gap = 4
  const spineWidth = (usable - gap * (spines - 1)) / spines

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-hidden="true"
      style={{ display: 'block', borderRadius: 'var(--sh-radius-md)' }}
    >
      <rect x="0" y="0" width={width} height={height} fill={`hsl(${hue} 30% 16%)`} />
      {Array.from({ length: spines }).map((_, i) => {
        const x = padding + i * (spineWidth + gap)
        // Pseudo-random but deterministic per index.
        const seed = (i * 73 + 17) % 100
        const lightness = 42 + (seed % 30)
        const spineHue = (hue + seed * 1.6) % 360
        const top = padding + (seed % 16)
        return (
          <g key={i}>
            <rect
              x={x}
              y={top}
              width={spineWidth}
              height={height - top - padding}
              rx="2"
              fill={`hsl(${spineHue} 45% ${lightness}%)`}
            />
            <rect
              x={x + spineWidth * 0.2}
              y={top + 14}
              width={spineWidth * 0.6}
              height={height - top - padding - 28}
              rx="1"
              fill={`hsl(${spineHue} 45% ${lightness + 12}%)`}
              opacity="0.55"
            />
          </g>
        )
      })}
      {/* Shelf board */}
      <rect x="0" y={height - padding} width={width} height={padding} fill={`hsl(${hue} 25% 10%)`} />
    </svg>
  )
}
