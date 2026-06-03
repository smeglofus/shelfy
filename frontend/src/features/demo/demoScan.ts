/**
 * Canned shelf-scan fixtures for the public client-side demo (#286).
 *
 * The real scan flow uploads a photo to the backend and runs an AI vision
 * pipeline. The demo must do **none** of that — zero upload, zero AI, zero
 * network. Instead, tapping a "sample photo" in the demo replays one of these
 * pre-baked results, so visitors can experience the full
 * scan → review → confirm wizard without generating any server load.
 *
 * Each photo yields a deterministic list of `ScannedBookItem`s. We deliberately
 * include a `needs_review` / no-text entry so the review step's
 * low-confidence affordances are visible in the demo.
 */
import type { ScannedBookItem } from '../../lib/types'

export interface DemoScanPhoto {
  /** Stable id — also used to derive the segment jobId and de-dupe tiles. */
  id: string
  /** Accent hue (degrees) used by the SVG illustration for visual variety. */
  hue: number
  /** Pre-baked detection result for this photo. */
  books: ScannedBookItem[]
}

export const DEMO_SCAN_PHOTOS: readonly DemoScanPhoto[] = [
  {
    id: 'photo-1',
    hue: 175,
    books: [
      {
        position: 0,
        title: 'Krakatit',
        author: 'Karel Čapek',
        isbn: null,
        observed_text: 'KRAKATIT — Karel Čapek',
        confidence: 'auto',
      },
      {
        position: 1,
        title: 'Bílá nemoc',
        author: 'Karel Čapek',
        isbn: null,
        observed_text: 'Bílá nemoc',
        confidence: 'auto',
      },
      {
        position: 2,
        title: 'Saturnin',
        author: 'Zdeněk Jirotka',
        isbn: null,
        observed_text: 'SATURNIN  Z. Jirotka',
        confidence: 'auto',
      },
      {
        position: 3,
        title: null,
        author: null,
        isbn: null,
        observed_text: 'no visible text',
        confidence: 'needs_review',
      },
    ],
  },
  {
    id: 'photo-2',
    hue: 25,
    books: [
      {
        position: 0,
        title: 'Fahrenheit 451',
        author: 'Ray Bradbury',
        isbn: null,
        observed_text: 'FAHRENHEIT 451 · Ray Bradbury',
        confidence: 'auto',
      },
      {
        position: 1,
        title: 'Marťan',
        author: 'Andy Weir',
        isbn: null,
        observed_text: 'Marťan / Andy Weir',
        confidence: 'auto',
      },
      {
        position: 2,
        title: 'Nadace',
        author: 'Isaac Asimov',
        isbn: null,
        observed_text: 'NADACE  Asimov',
        confidence: 'auto',
      },
    ],
  },
] as const
