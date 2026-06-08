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

import { createDemoBooks, createDemoBorrowers, createDemoLoans, createDemoLocations } from '../features/demo/demoSeed'
import type {
  Book,
  BookCreateRequest,
  BookListParams,
  BookListResponse,
  BookUpdateRequest,
  Borrower,
  BorrowerDetail,
  BorrowerListItem,
  BorrowerListParams,
  BorrowerListResponse,
  BorrowerLoanItem,
  BorrowerUpdateRequest,
  Loan,
  LoanCreateRequest,
  LoanReturnRequest,
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
  borrowers: Borrower[]
  loans: Loan[]
}

interface DemoActions {
  // ── Read selectors (mirror lib/api.ts response shapes) ──
  queryBooks: (params?: BookListParams) => BookListResponse
  booksForShelf: () => Book[]
  booksByLocation: (locationId: string) => Book[]
  counts: () => DemoBookCounts
  // ── Borrower / loan read selectors ──
  queryBorrowers: (params?: BorrowerListParams) => BorrowerListResponse
  getBorrowerDetail: (id: string) => BorrowerDetail | null
  borrowerLoans: (id: string) => BorrowerLoanItem[]
  loansForBook: (bookId: string) => Loan[]
  // ── Write actions (all in-memory) ──
  addBook: (payload: BookCreateRequest) => Book
  updateBook: (id: string, payload: BookUpdateRequest) => Book | null
  deleteBook: (id: string) => void
  bulkDelete: (ids: string[]) => void
  bulkMove: (ids: string[], locationId: string | null) => void
  bulkUpdateStatus: (ids: string[], status: ReadingStatus) => void
  reorder: (items: ReorderItem[]) => void
  confirmShelfScan: (payload: ShelfScanConfirmRequest) => ShelfScanConfirmResponse
  // ── Borrower / loan write actions ──
  updateBorrower: (id: string, payload: BorrowerUpdateRequest) => Borrower | null
  createLoan: (bookId: string, payload: LoanCreateRequest) => Loan
  returnLoan: (bookId: string, loanId: string, payload: LoanReturnRequest) => Loan | null
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

function prefixedId(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`
    }
  } catch {
    /* fall through */
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

/** Derive the list-row aggregates (`active_loans`, `total_loans`,
 *  `last_activity_at`) for a borrower from the loan set. Exported for tests. */
export function borrowerListItem(borrower: Borrower, loans: Loan[]): BorrowerListItem {
  const mine = loans.filter((l) => l.borrower_id === borrower.id)
  const dates: string[] = []
  for (const l of mine) {
    dates.push(l.lent_date)
    if (l.returned_date) dates.push(l.returned_date)
  }
  dates.sort()
  return {
    ...borrower,
    active_loans: mine.filter((l) => l.returned_date === null).length,
    total_loans: mine.length,
    last_activity_at: dates.length > 0 ? dates[dates.length - 1] : null,
  }
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
      borrowers: createDemoBorrowers(),
      loans: createDemoLoans(),

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

      queryBorrowers: (params = {}) => {
        const { borrowers, loans } = get()
        const search = params.search?.trim().toLowerCase()
        const status = params.status ?? 'all'
        let rows = borrowers.map((b) => borrowerListItem(b, loans))
        if (search) {
          rows = rows.filter((b) =>
            [b.name, b.contact ?? ''].join(' ').toLowerCase().includes(search),
          )
        }
        if (status === 'active') {
          rows = rows.filter((b) => b.active_loans > 0)
        } else if (status === 'pending') {
          // No anonymization in the demo — the recovery view is always empty.
          rows = rows.filter((b) => b.anonymized_at === null && b.pending_anonymization_until !== null)
        }
        rows.sort((a, b) => a.name.localeCompare(b.name))
        const page = params.page ?? 1
        const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE
        const start = (page - 1) * pageSize
        return {
          total: rows.length,
          page,
          page_size: pageSize,
          items: rows.slice(start, start + pageSize),
        }
      },

      getBorrowerDetail: (id) => {
        const borrower = get().borrowers.find((b) => b.id === id)
        if (!borrower) return null
        // The demo has no user accounts, so every audit FK is null — which is
        // exactly the "legacy row" shape the detail page hides the footer for.
        return {
          ...borrower,
          created_by_email: null,
          anonymized_by_email: null,
          merged_into_by_email: null,
        }
      },

      borrowerLoans: (id) => {
        const { books, loans } = get()
        const titleOf = new Map(books.map((b) => [b.id, b]))
        return loans
          .filter((l) => l.borrower_id === id)
          .sort((a, b) => (a.lent_date < b.lent_date ? 1 : -1))
          .map((l) => {
            const book = titleOf.get(l.book_id)
            return {
              id: l.id,
              book_id: l.book_id,
              book_title: book?.title ?? l.book_id,
              book_author: book?.author ?? null,
              lent_date: l.lent_date,
              due_date: l.due_date,
              returned_date: l.returned_date,
              return_condition: l.return_condition,
              notes: l.notes,
            }
          })
      },

      loansForBook: (bookId) =>
        get()
          .loans.filter((l) => l.book_id === bookId)
          .sort((a, b) => (a.lent_date < b.lent_date ? 1 : -1)),

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

      updateBorrower: (id, payload) => {
        const now = new Date().toISOString()
        let updated: Borrower | null = null
        set((s) => {
          const borrowers = s.borrowers.map((b) => {
            if (b.id !== id) return b
            updated = {
              ...b,
              name: payload.name !== undefined ? payload.name : b.name,
              contact: payload.contact !== undefined ? payload.contact : b.contact,
              notes: payload.notes !== undefined ? payload.notes : b.notes,
              updated_at: now,
            }
            return updated
          })
          if (!updated) return {}
          const fresh = updated
          // ADR 008: edits do NOT rewrite the denormalized snapshot columns on
          // historical loan rows — but the nested `borrower` object is resolved
          // live, so refresh it everywhere it's referenced (loan rows + the
          // active loan carried on the book).
          const loans = s.loans.map((l) =>
            l.borrower_id === id ? { ...l, borrower: fresh } : l,
          )
          const books = s.books.map((b) =>
            b.active_loan && b.active_loan.borrower_id === id
              ? { ...b, active_loan: { ...b.active_loan, borrower: fresh } }
              : b,
          )
          return { borrowers, loans, books }
        })
        return updated
      },

      createLoan: (bookId, payload) => {
        const now = new Date().toISOString()
        const lentDate = payload.lent_date
        let borrower: Borrower | null = null
        const newBorrowers: Borrower[] = []

        if (payload.borrower_id) {
          borrower = get().borrowers.find((b) => b.id === payload.borrower_id) ?? null
        }
        if (!borrower) {
          // Typed-name flow: mint a fresh borrower record (mirrors the backend
          // creating a Borrower when a loan is made against a new name).
          borrower = {
            id: prefixedId('demo-borrower'),
            name: payload.borrower_name?.trim() || 'Neznámý',
            contact: payload.borrower_contact?.trim() || null,
            notes: null,
            anonymized_at: null,
            pending_anonymization_until: null,
            created_by_user_id: null,
            anonymized_by_user_id: null,
            merged_into_by_user_id: null,
            created_at: now,
            updated_at: now,
          }
          newBorrowers.push(borrower)
        }

        const loan: Loan = {
          id: prefixedId('demo-loan'),
          book_id: bookId,
          borrower_id: borrower.id,
          borrower_name: borrower.name,
          borrower_contact: borrower.contact,
          borrower,
          lent_date: lentDate,
          due_date: payload.due_date ?? null,
          returned_date: null,
          return_condition: null,
          notes: payload.notes ?? null,
          created_at: now,
          is_active: true,
        }

        set((s) => ({
          borrowers: newBorrowers.length ? [...s.borrowers, ...newBorrowers] : s.borrowers,
          loans: [...s.loans, loan],
          books: s.books.map((b) =>
            b.id === bookId
              ? { ...b, is_currently_lent: true, active_loan: loan, updated_at: now }
              : b,
          ),
        }))
        return loan
      },

      returnLoan: (bookId, loanId, payload) => {
        const now = new Date().toISOString()
        let updated: Loan | null = null
        set((s) => {
          const loans = s.loans.map((l) => {
            if (l.id !== loanId) return l
            updated = {
              ...l,
              returned_date: payload.returned_date,
              return_condition: payload.return_condition,
              notes: payload.notes ?? l.notes,
              is_active: false,
            }
            return updated
          })
          if (!updated) return {}
          const books = s.books.map((b) =>
            b.id === bookId
              ? { ...b, is_currently_lent: false, active_loan: null, updated_at: now }
              : b,
          )
          return { loans, books }
        })
        return updated
      },

      reset: () =>
        set({
          books: createDemoBooks(),
          locations: createDemoLocations(),
          borrowers: createDemoBorrowers(),
          loans: createDemoLoans(),
        }),
    }),
    {
      name: DEMO_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      // Persist data only — never the action closures.
      partialize: (state) => ({
        books: state.books,
        locations: state.locations,
        borrowers: state.borrowers,
        loans: state.loans,
      }),
    },
  ),
)
