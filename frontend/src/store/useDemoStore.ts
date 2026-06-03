/**
 * useDemoStore — in-memory library for the client-side landing demo (#284).
 *
 * Holds a sandboxed copy of the seed library (`features/demo/demoSeed.ts`) and
 * exposes read selectors + write actions that mirror the shapes the real
 * TanStack Query hooks return, so the demo-aware hooks in #285 can swap data
 * sources without the pages noticing.
 *
 * Persistence (see #284):
 *  - Backed by `sessionStorage` under {@link DEMO_STORAGE_KEY}.
 *  - Survives in-app navigation within the same tab.
 *  - A fresh tab / new session starts from the pristine seed (empty storage
 *    falls back to the initializer).
 *  - `reset()` re-seeds from `demoSeed` (pristine) and rewrites storage.
 *  - Only the data (`books`, `locations`) is persisted — never the action
 *    functions — and it is text-only (no blobs) to stay well under quota.
 *
 * Everything here is pure in-memory: NO network calls, ever. That is the whole
 * point of the demo (zero backend/AI load for unauthenticated visitors).
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { createDemoBooks, createDemoLocations } from '../features/demo/demoSeed'
import type {
  Book,
  BookCreateRequest,
  BookListParams,
  BookListResponse,
  BookUpdateRequest,
  Location,
  ReadingStatus,
  ShelfScanConfirmRequest,
  ShelfScanConfirmResponse,
} from '../lib/types'

export const DEMO_STORAGE_KEY = 'shelfy:demo:v1'

const DEFAULT_PAGE_SIZE = 20

export interface DemoBookCounts {
  total: number
  read: number
  reading: number
  lent: number
}

export interface ReorderItem {
  id: string
  location_id: string | null
  shelf_position: number
}

interface DemoData {
  books: Book[]
  locations: Location[]
}

interface DemoActions {
  // ── Read selectors (mirror lib/api.ts response shapes) ──
  queryBooks: (params?: BookListParams) => BookListResponse
  booksForShelf: () => Book[]
  booksByLocation: (locationId: string) => Book[]
  counts: () => DemoBookCounts
  // ── Write actions (all in-memory) ──
  addBook: (payload: BookCreateRequest) => Book
  updateBook: (id: string, payload: BookUpdateRequest) => Book | null
  deleteBook: (id: string) => void
  bulkDelete: (ids: string[]) => void
  bulkMove: (ids: string[], locationId: string | null) => void
  bulkUpdateStatus: (ids: string[], status: ReadingStatus) => void
  reorder: (items: ReorderItem[]) => void
  confirmShelfScan: (payload: ShelfScanConfirmRequest) => ShelfScanConfirmResponse
  reset: () => void
}

export type DemoState = DemoData & DemoActions

// ── Pure helpers (exported for unit testing) ───────────────────────────────

function nextId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `demo-book-${crypto.randomUUID()}`
    }
  } catch {
    /* fall through */
  }
  return `demo-book-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

function shelfOrder(books: Book[], locations: Location[]): Book[] {
  const orderOf = new Map(locations.map((l) => [l.id, l.display_order]))
  return [...books].sort((a, b) => {
    const la = a.location_id ? orderOf.get(a.location_id) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
    const lb = b.location_id ? orderOf.get(b.location_id) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
    if (la !== lb) return la - lb
    const pa = a.shelf_position ?? Number.MAX_SAFE_INTEGER
    const pb = b.shelf_position ?? Number.MAX_SAFE_INTEGER
    if (pa !== pb) return pa - pb
    return a.title.localeCompare(b.title)
  })
}

/** Replicates the server-side filtering of `listBooks` for the demo dataset. */
export function filterBooks(books: Book[], params: BookListParams = {}): Book[] {
  const search = params.search?.trim().toLowerCase()
  return books.filter((book) => {
    if (search) {
      const haystack = [book.title, book.author ?? '', book.isbn ?? ''].join(' ').toLowerCase()
      if (!haystack.includes(search)) return false
    }
    if (params.locationId && book.location_id !== params.locationId) return false
    if (params.unassignedOnly && book.location_id) return false
    if (params.readingStatus && book.reading_status !== params.readingStatus) return false
    if (params.language && book.language !== params.language) return false
    if (params.publisher && book.publisher !== params.publisher) return false
    if (typeof params.yearFrom === 'number' && (book.publication_year ?? -Infinity) < params.yearFrom) return false
    if (typeof params.yearTo === 'number' && (book.publication_year ?? Infinity) > params.yearTo) return false
    return true
  })
}

function applyUpdate(book: Book, payload: BookUpdateRequest): Book {
  const next: Book = { ...book, updated_at: new Date().toISOString() }
  const assignIfPresent = <K extends keyof BookUpdateRequest & keyof Book>(key: K) => {
    if (payload[key] !== undefined) {
      ;(next[key] as Book[K]) = payload[key] as Book[K]
    }
  }
  assignIfPresent('title')
  assignIfPresent('author')
  assignIfPresent('isbn')
  assignIfPresent('publisher')
  assignIfPresent('language')
  assignIfPresent('description')
  assignIfPresent('publication_year')
  assignIfPresent('cover_image_url')
  assignIfPresent('location_id')
  assignIfPresent('shelf_position')
  assignIfPresent('reading_status')
  return next
}

// ── Store ──────────────────────────────────────────────────────────────────

export const useDemoStore = create<DemoState>()(
  persist(
    (set, get) => ({
      books: createDemoBooks(),
      locations: createDemoLocations(),

      queryBooks: (params = {}) => {
        const all = get().books
        const filtered = shelfOrder(filterBooks(all, params), get().locations)
        const page = params.page ?? 1
        const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE
        const start = (page - 1) * pageSize
        return {
          total: filtered.length,
          page,
          page_size: pageSize,
          has_sample_books: all.some((b) => b.is_sample),
          items: filtered.slice(start, start + pageSize),
        }
      },

      booksForShelf: () => shelfOrder(get().books, get().locations),

      booksByLocation: (locationId) =>
        shelfOrder(
          get().books.filter((b) => b.location_id === locationId),
          get().locations,
        ),

      counts: () => {
        const books = get().books
        return {
          total: books.length,
          read: books.filter((b) => b.reading_status === 'read').length,
          reading: books.filter((b) => b.reading_status === 'reading').length,
          lent: books.filter((b) => b.reading_status === 'lent').length,
        }
      },

      addBook: (payload) => {
        const now = new Date().toISOString()
        const locationId = payload.location_id ?? null
        // Append to the end of the target shelf when no explicit position given.
        const siblings = get().books.filter((b) => b.location_id === locationId)
        const maxPos = siblings.reduce((m, b) => Math.max(m, b.shelf_position ?? -1), -1)
        const book: Book = {
          id: nextId(),
          title: payload.title,
          author: payload.author ?? null,
          isbn: payload.isbn ?? null,
          publisher: payload.publisher ?? null,
          language: payload.language ?? null,
          description: payload.description ?? null,
          publication_year: payload.publication_year ?? null,
          cover_image_url: payload.cover_image_url ?? null,
          location_id: locationId,
          shelf_position: payload.shelf_position ?? maxPos + 1,
          processing_status: 'done',
          reading_status: payload.reading_status ?? 'unread',
          is_currently_lent: false,
          active_loan: null,
          is_sample: false,
          created_at: now,
          updated_at: now,
        }
        set((s) => ({ books: [...s.books, book] }))
        return book
      },

      updateBook: (id, payload) => {
        let updated: Book | null = null
        set((s) => ({
          books: s.books.map((b) => {
            if (b.id !== id) return b
            updated = applyUpdate(b, payload)
            return updated
          }),
        }))
        return updated
      },

      deleteBook: (id) => set((s) => ({ books: s.books.filter((b) => b.id !== id) })),

      bulkDelete: (ids) => {
        const remove = new Set(ids)
        set((s) => ({ books: s.books.filter((b) => !remove.has(b.id)) }))
      },

      bulkMove: (ids, locationId) => {
        const move = new Set(ids)
        const now = new Date().toISOString()
        set((s) => ({
          books: s.books.map((b) =>
            move.has(b.id) ? { ...b, location_id: locationId, updated_at: now } : b,
          ),
        }))
      },

      bulkUpdateStatus: (ids, status) => {
        const target = new Set(ids)
        const now = new Date().toISOString()
        set((s) => ({
          books: s.books.map((b) =>
            target.has(b.id) ? { ...b, reading_status: status, updated_at: now } : b,
          ),
        }))
      },

      reorder: (items) => {
        const byId = new Map(items.map((i) => [i.id, i]))
        const now = new Date().toISOString()
        set((s) => ({
          books: s.books.map((b) => {
            const move = byId.get(b.id)
            return move
              ? { ...b, location_id: move.location_id, shelf_position: move.shelf_position, updated_at: now }
              : b
          }),
        }))
      },

      confirmShelfScan: (payload) => {
        const now = new Date().toISOString()
        const { location_id, append_after_book_id, books } = payload

        // Build the freshly scanned books (all in-memory, never sample).
        const newBooks: Book[] = books.map((b, i) => ({
          id: nextId(),
          title: b.title,
          author: b.author ?? null,
          isbn: b.isbn ?? null,
          publisher: null,
          language: null,
          description: null,
          publication_year: null,
          cover_image_url: null,
          location_id,
          shelf_position: i,
          processing_status: 'done',
          reading_status: 'unread',
          is_currently_lent: false,
          active_loan: null,
          is_sample: false,
          created_at: now,
          updated_at: now,
        }))

        set((s) => {
          if (!append_after_book_id) {
            // Replace mode: drop existing books on this shelf, then add scanned
            // ones at positions 0..n-1.
            const others = s.books.filter((b) => b.location_id !== location_id)
            return { books: [...others, ...newBooks] }
          }

          // Append-right mode: insert after the anchor book, shifting the books
          // that currently sit to its right.
          const anchor = s.books.find((b) => b.id === append_after_book_id)
          const anchorPos = anchor?.shelf_position ?? -1
          const shifted = s.books.map((b) =>
            b.location_id === location_id && (b.shelf_position ?? 0) > anchorPos
              ? { ...b, shelf_position: (b.shelf_position ?? 0) + newBooks.length, updated_at: now }
              : b,
          )
          const placed = newBooks.map((b, i) => ({ ...b, shelf_position: anchorPos + 1 + i }))
          return { books: [...shifted, ...placed] }
        })

        return { created_count: newBooks.length, book_ids: newBooks.map((b) => b.id) }
      },

      reset: () => set({ books: createDemoBooks(), locations: createDemoLocations() }),
    }),
    {
      name: DEMO_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      // Persist data only — never the action closures.
      partialize: (state) => ({ books: state.books, locations: state.locations }),
    },
  ),
)
