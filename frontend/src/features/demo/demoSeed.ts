/**
 * Demo seed data — a self-contained, client-side mirror of the backend sample
 * library (`backend/app/services/library.py` `_SAMPLE_LOCATIONS` / `_SAMPLE_BOOKS`).
 *
 * The on-landing demo (#284–#287) runs entirely in the browser so that
 * unauthenticated visitors generate **zero** data/AI/upload load on the server.
 * This module is the single source of truth for that seeded library.
 *
 * Fidelity notes (see #284):
 *  - Every required field of `Book` / `Location` (`lib/types.ts`) is populated
 *    with an explicit value — no `as any`, no missing fields.
 *  - IDs are deterministic (`demo-loc-1`, `demo-book-01`, …) so React keys and
 *    `/demo/:id` links stay stable across reloads.
 *  - Timestamps are a fixed constant (not `Date.now()`) so snapshots/tests are
 *    deterministic.
 *  - The factory functions return **fresh** arrays/objects on every call, so a
 *    `reset()` can never be polluted by in-place demo mutations.
 */
import type { Book, Location, ReadingStatus } from '../../lib/types'

/** Fixed timestamp for all seed rows — keeps demo snapshots deterministic. */
export const DEMO_SEED_TS = '2026-01-01T00:00:00.000Z'

interface SeedLocation {
  id: string
  room: string
  furniture: string
  shelf: string
  display_order: number
}

const SEED_LOCATIONS: readonly SeedLocation[] = [
  { id: 'demo-loc-1', room: 'Living room', furniture: 'Bookcase', shelf: 'Shelf 1', display_order: 1 },
  { id: 'demo-loc-2', room: 'Living room', furniture: 'Bookcase', shelf: 'Shelf 2', display_order: 2 },
  { id: 'demo-loc-3', room: 'Bedroom', furniture: 'Nightstand', shelf: 'To read', display_order: 1 },
] as const

/** [title, author, language, year, reading_status, locationIndex, shelf_position] */
type SeedBook = readonly [string, string, string, number, ReadingStatus, number, number]

const SEED_BOOKS: readonly SeedBook[] = [
  ['Proměna', 'Franz Kafka', 'cs', 1915, 'read', 0, 0],
  ['R.U.R.', 'Karel Čapek', 'cs', 1920, 'read', 0, 1],
  ['Ostře sledované vlaky', 'Bohumil Hrabal', 'cs', 1965, 'read', 0, 2],
  ['Báječná léta pod psa', 'Michal Viewegh', 'cs', 1992, 'reading', 0, 3],
  ['Zaklínač I: Poslední přání', 'Andrzej Sapkowski', 'cs', 1990, 'reading', 0, 4],
  ['Hobit', 'J.R.R. Tolkien', 'cs', 1937, 'read', 0, 5],
  ['Nesnesitelná lehkost bytí', 'Milan Kundera', 'cs', 1984, 'read', 1, 0],
  ['Osudy dobrého vojáka Švejka', 'Jaroslav Hašek', 'cs', 1923, 'read', 1, 1],
  ['1984', 'George Orwell', 'en', 1949, 'read', 1, 2],
  ['Stopařův průvodce po galaxii', 'Douglas Adams', 'en', 1979, 'read', 1, 3],
  ['Malý princ', 'Antoine de Saint-Exupéry', 'cs', 1943, 'read', 1, 4],
  ['Zločin a trest', 'Fjodor Michajlovič Dostojevský', 'cs', 1866, 'unread', 2, 0],
  ['Sto roků samoty', 'Gabriel García Márquez', 'cs', 1967, 'unread', 2, 1],
  ['Mistr a Markétka', 'Michail Bulgakov', 'cs', 1967, 'unread', 2, 2],
  ['Duna', 'Frank Herbert', 'cs', 1965, 'unread', 2, 3],
  ['Pán prstenů: Společenstvo prstenu', 'J.R.R. Tolkien', 'cs', 1954, 'unread', 2, 4],
] as const

/** Build a fresh array of seed locations (new objects every call). */
export function createDemoLocations(): Location[] {
  return SEED_LOCATIONS.map((loc) => ({
    id: loc.id,
    room: loc.room,
    furniture: loc.furniture,
    shelf: loc.shelf,
    display_order: loc.display_order,
    is_sample: true,
    created_at: DEMO_SEED_TS,
    updated_at: DEMO_SEED_TS,
  }))
}

/** Build a fresh array of seed books (new objects every call). */
export function createDemoBooks(): Book[] {
  return SEED_BOOKS.map(([title, author, language, year, readingStatus, locIdx, shelfPos], index) => ({
    id: `demo-book-${String(index + 1).padStart(2, '0')}`,
    title,
    author,
    isbn: null,
    publisher: null,
    language,
    description: null,
    publication_year: year,
    cover_image_url: null,
    location_id: SEED_LOCATIONS[locIdx].id,
    shelf_position: shelfPos,
    processing_status: 'done',
    reading_status: readingStatus,
    is_currently_lent: false,
    active_loan: null,
    is_sample: true,
    created_at: DEMO_SEED_TS,
    updated_at: DEMO_SEED_TS,
  }))
}
