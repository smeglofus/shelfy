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
  // ── Shelf 1 — Living room / Bookcase (34 books, positions 0–33) ──
  ['Proměna', 'Franz Kafka', 'cs', 1915, 'read', 0, 0],
  ['R.U.R.', 'Karel Čapek', 'cs', 1920, 'read', 0, 1],
  ['Ostře sledované vlaky', 'Bohumil Hrabal', 'cs', 1965, 'read', 0, 2],
  ['Báječná léta pod psa', 'Michal Viewegh', 'cs', 1992, 'reading', 0, 3],
  ['Zaklínač I: Poslední přání', 'Andrzej Sapkowski', 'cs', 1990, 'reading', 0, 4],
  ['Hobit', 'J.R.R. Tolkien', 'cs', 1937, 'read', 0, 5],
  ['Krakatit', 'Karel Čapek', 'cs', 1924, 'read', 0, 6],
  ['Bílá nemoc', 'Karel Čapek', 'cs', 1937, 'read', 0, 7],
  ['Saturnin', 'Zdeněk Jirotka', 'cs', 1942, 'read', 0, 8],
  ['Válka s mloky', 'Karel Čapek', 'cs', 1936, 'read', 0, 9],
  ['Bylo nás pět', 'Karel Poláček', 'cs', 1946, 'read', 0, 10],
  ['Babička', 'Božena Němcová', 'cs', 1855, 'read', 0, 11],
  ['Romeo a Julie', 'William Shakespeare', 'cs', 1597, 'read', 0, 12],
  ['Hamlet', 'William Shakespeare', 'cs', 1603, 'read', 0, 13],
  ['Velký Gatsby', 'F. Scott Fitzgerald', 'cs', 1925, 'read', 0, 14],
  ['Na cestě', 'Jack Kerouac', 'cs', 1957, 'reading', 0, 15],
  ['Kdo chytá v žitě', 'J.D. Salinger', 'cs', 1951, 'read', 0, 16],
  ['Pýcha a předsudek', 'Jane Austen', 'cs', 1813, 'read', 0, 17],
  ['Jana Eyrová', 'Charlotte Brontëová', 'cs', 1847, 'read', 0, 18],
  ['Na Větrné hůrce', 'Emily Brontëová', 'cs', 1847, 'unread', 0, 19],
  ['Tři mušketýři', 'Alexandre Dumas', 'cs', 1844, 'read', 0, 20],
  ['Hrabě Monte Cristo', 'Alexandre Dumas', 'cs', 1845, 'reading', 0, 21],
  ['Bídníci', 'Victor Hugo', 'cs', 1862, 'unread', 0, 22],
  ['Anna Kareninová', 'Lev Nikolajevič Tolstoj', 'cs', 1877, 'unread', 0, 23],
  ['Vojna a mír', 'Lev Nikolajevič Tolstoj', 'cs', 1869, 'unread', 0, 24],
  ['Idiot', 'Fjodor Michajlovič Dostojevský', 'cs', 1869, 'unread', 0, 25],
  ['Bratři Karamazovi', 'Fjodor Michajlovič Dostojevský', 'cs', 1880, 'unread', 0, 26],
  ['Lakomec', 'Molière', 'cs', 1668, 'read', 0, 27],
  ['Faust', 'Johann Wolfgang von Goethe', 'cs', 1808, 'unread', 0, 28],
  ['Proces', 'Franz Kafka', 'cs', 1925, 'read', 0, 29],
  ['Zámek', 'Franz Kafka', 'cs', 1926, 'unread', 0, 30],
  ['Cizinec', 'Albert Camus', 'cs', 1942, 'read', 0, 31],
  ['Mor', 'Albert Camus', 'cs', 1947, 'reading', 0, 32],
  ['Stařec a moře', 'Ernest Hemingway', 'cs', 1952, 'read', 0, 33],

  // ── Shelf 2 — Living room / Bookcase (33 books, positions 0–32) ──
  ['Nesnesitelná lehkost bytí', 'Milan Kundera', 'cs', 1984, 'read', 1, 0],
  ['Osudy dobrého vojáka Švejka', 'Jaroslav Hašek', 'cs', 1923, 'read', 1, 1],
  ['1984', 'George Orwell', 'en', 1949, 'read', 1, 2],
  ['Stopařův průvodce po galaxii', 'Douglas Adams', 'en', 1979, 'read', 1, 3],
  ['Malý princ', 'Antoine de Saint-Exupéry', 'cs', 1943, 'read', 1, 4],
  ['Farma zvířat', 'George Orwell', 'cs', 1945, 'read', 1, 5],
  ['451 stupňů Fahrenheita', 'Ray Bradbury', 'cs', 1953, 'read', 1, 6],
  ['Marťanská kronika', 'Ray Bradbury', 'cs', 1950, 'reading', 1, 7],
  ['Nadace', 'Isaac Asimov', 'cs', 1951, 'unread', 1, 8],
  ['Já, robot', 'Isaac Asimov', 'cs', 1950, 'read', 1, 9],
  ['Konec dětství', 'Arthur C. Clarke', 'cs', 1953, 'unread', 1, 10],
  ['2001: Vesmírná odysea', 'Arthur C. Clarke', 'cs', 1968, 'unread', 1, 11],
  ['Solaris', 'Stanisław Lem', 'cs', 1961, 'unread', 1, 12],
  ['Kyberiáda', 'Stanisław Lem', 'cs', 1965, 'unread', 1, 13],
  ['Neuromancer', 'William Gibson', 'cs', 1984, 'unread', 1, 14],
  ['Sní androidi o elektrických ovečkách?', 'Philip K. Dick', 'cs', 1968, 'unread', 1, 15],
  ['Hra o trůny', 'George R.R. Martin', 'cs', 1996, 'reading', 1, 16],
  ['Jméno větru', 'Patrick Rothfuss', 'cs', 2007, 'read', 1, 17],
  ['Enderova hra', 'Orson Scott Card', 'cs', 1985, 'read', 1, 18],
  ['Hyperion', 'Dan Simmons', 'cs', 1989, 'unread', 1, 19],
  ['Zaklínač II: Meč osudu', 'Andrzej Sapkowski', 'cs', 1992, 'reading', 1, 20],
  ['Krev elfů', 'Andrzej Sapkowski', 'cs', 1994, 'unread', 1, 21],
  ['Pán prstenů: Dvě věže', 'J.R.R. Tolkien', 'cs', 1954, 'read', 1, 22],
  ['Pán prstenů: Návrat krále', 'J.R.R. Tolkien', 'cs', 1955, 'read', 1, 23],
  ['Silmarillion', 'J.R.R. Tolkien', 'cs', 1977, 'unread', 1, 24],
  ['Harry Potter a Kámen mudrců', 'J.K. Rowlingová', 'cs', 1997, 'read', 1, 25],
  ['Harry Potter a Tajemná komnata', 'J.K. Rowlingová', 'cs', 1998, 'read', 1, 26],
  ['Lev, čarodějnice a skříň', 'C.S. Lewis', 'cs', 1950, 'read', 1, 27],
  ['Hvězdný prach', 'Neil Gaiman', 'cs', 1999, 'reading', 1, 28],
  ['Američtí bohové', 'Neil Gaiman', 'cs', 2001, 'unread', 1, 29],
  ['Dobrá znamení', 'Terry Pratchett', 'cs', 1990, 'read', 1, 30],
  ['Barva kouzel', 'Terry Pratchett', 'cs', 1983, 'read', 1, 31],
  ['Mort', 'Terry Pratchett', 'cs', 1987, 'reading', 1, 32],

  // ── To read — Bedroom / Nightstand (33 books, positions 0–32) ──
  ['Zločin a trest', 'Fjodor Michajlovič Dostojevský', 'cs', 1866, 'unread', 2, 0],
  ['Sto roků samoty', 'Gabriel García Márquez', 'cs', 1967, 'unread', 2, 1],
  ['Mistr a Markétka', 'Michail Bulgakov', 'cs', 1967, 'unread', 2, 2],
  ['Duna', 'Frank Herbert', 'cs', 1965, 'unread', 2, 3],
  ['Pán prstenů: Společenstvo prstenu', 'J.R.R. Tolkien', 'cs', 1954, 'unread', 2, 4],
  ['Jméno růže', 'Umberto Eco', 'cs', 1980, 'unread', 2, 5],
  ['Foucaultovo kyvadlo', 'Umberto Eco', 'cs', 1988, 'unread', 2, 6],
  ['Stoletý stařík, který vylezl z okna a zmizel', 'Jonas Jonasson', 'cs', 2009, 'unread', 2, 7],
  ['Muž jménem Ove', 'Fredrik Backman', 'cs', 2012, 'unread', 2, 8],
  ['Pět lidí, které potkáte v nebi', 'Mitch Albom', 'cs', 2003, 'unread', 2, 9],
  ['Kafka na pobřeží', 'Haruki Murakami', 'cs', 2002, 'unread', 2, 10],
  ['Norské dřevo', 'Haruki Murakami', 'cs', 1987, 'reading', 2, 11],
  ['1Q84', 'Haruki Murakami', 'cs', 2009, 'unread', 2, 12],
  ['Lovec draků', 'Khaled Hosseini', 'cs', 2003, 'unread', 2, 13],
  ['Tisíce planoucích sluncí', 'Khaled Hosseini', 'cs', 2007, 'unread', 2, 14],
  ['Pí a jeho život', 'Yann Martel', 'cs', 2001, 'unread', 2, 15],
  ['Oko světa', 'Robert Jordan', 'cs', 1990, 'unread', 2, 16],
  ['Šifra mistra Leonarda', 'Dan Brown', 'cs', 2003, 'read', 2, 17],
  ['Andělé a démoni', 'Dan Brown', 'cs', 2000, 'read', 2, 18],
  ['Muži, kteří nenávidí ženy', 'Stieg Larsson', 'cs', 2005, 'unread', 2, 19],
  ['Mlčení jehňátek', 'Thomas Harris', 'cs', 1988, 'unread', 2, 20],
  ['To', 'Stephen King', 'cs', 1986, 'unread', 2, 21],
  ['Osvícení', 'Stephen King', 'cs', 1977, 'unread', 2, 22],
  ['Zelená míle', 'Stephen King', 'cs', 1996, 'unread', 2, 23],
  ['Pistolník', 'Stephen King', 'cs', 1982, 'unread', 2, 24],
  ['Pokání', 'Ian McEwan', 'cs', 2001, 'unread', 2, 25],
  ['Skleněný hrad', 'Jeannette Walls', 'cs', 2005, 'unread', 2, 26],
  ['Stín větru', 'Carlos Ruiz Zafón', 'cs', 2001, 'unread', 2, 27],
  ['Parfém: Příběh vraha', 'Patrick Süskind', 'cs', 1985, 'read', 2, 28],
  ['Alchymista', 'Paulo Coelho', 'cs', 1988, 'read', 2, 29],
  ['Veronika se rozhodla zemřít', 'Paulo Coelho', 'cs', 1998, 'unread', 2, 30],
  ['Žít!', 'Jü Chua', 'cs', 1993, 'unread', 2, 31],
  ['Snídaně u Tiffanyho', 'Truman Capote', 'cs', 1958, 'unread', 2, 32],
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
