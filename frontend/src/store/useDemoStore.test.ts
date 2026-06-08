import { beforeEach, describe, expect, it } from 'vitest'

import { createDemoBooks, createDemoLocations } from '../features/demo/demoSeed'
import { DEMO_STORAGE_KEY, filterBooks, useDemoStore } from './useDemoStore'

function freshStore() {
  // Each test starts from a pristine, isolated seed.
  sessionStorage.clear()
  useDemoStore.getState().reset()
  return useDemoStore.getState
}

beforeEach(() => {
  freshStore()
})

describe('demoSeed', () => {
  it('mirrors the backend sample set (3 shelves, 100 books) with full type fidelity', () => {
    const locations = createDemoLocations()
    const books = createDemoBooks()
    expect(locations).toHaveLength(3)
    expect(books).toHaveLength(100)
    // Every book has all required fields populated (no undefined holes).
    for (const b of books) {
      expect(b.id).toMatch(/^demo-book-\d{2,}$/)
      expect(b.is_sample).toBe(true)
      expect(b.processing_status).toBe('done')
      expect(typeof b.created_at).toBe('string')
      expect(b.location_id).toBeTruthy()
      expect(typeof b.shelf_position).toBe('number')
    }
  })

  it('returns fresh objects each call (no shared mutable references)', () => {
    const a = createDemoBooks()
    const b = createDemoBooks()
    expect(a).not.toBe(b)
    expect(a[0]).not.toBe(b[0])
    a[0].title = 'mutated'
    expect(b[0].title).not.toBe('mutated')
  })
})

describe('filterBooks', () => {
  const books = createDemoBooks()

  it('searches title / author case-insensitively', () => {
    expect(filterBooks(books, { search: 'tolkien' })).toHaveLength(5)
    expect(filterBooks(books, { search: 'HOBIT' }).map((b) => b.title)).toContain('Hobit')
  })

  it('filters by reading status and location', () => {
    expect(filterBooks(books, { readingStatus: 'reading' })).toHaveLength(11)
    expect(filterBooks(books, { locationId: 'demo-loc-3' })).toHaveLength(33)
  })

  it('filters by language and publication-year range', () => {
    expect(filterBooks(books, { language: 'en' })).toHaveLength(2)
    expect(filterBooks(books, { yearFrom: 1980 }).every((b) => (b.publication_year ?? 0) >= 1980)).toBe(true)
  })
})

describe('useDemoStore', () => {
  it('queryBooks paginates and reports total', () => {
    const get = useDemoStore.getState
    const page1 = get().queryBooks({ pageSize: 10, page: 1 })
    expect(page1.total).toBe(100)
    expect(page1.items).toHaveLength(10)
    expect(page1.has_sample_books).toBe(true)
    const page2 = get().queryBooks({ pageSize: 10, page: 2 })
    expect(page2.items).toHaveLength(10)
  })

  it('counts reflects reading statuses', () => {
    const c = useDemoStore.getState().counts()
    expect(c.total).toBe(100)
    expect(c.read).toBe(42)
    expect(c.reading).toBe(11)
    expect(c.lent).toBe(0)
  })

  it('addBook appends to the end of the target shelf', () => {
    const get = useDemoStore.getState
    const created = get().addBook({ title: 'New Book', location_id: 'demo-loc-3' })
    expect(created.id).toContain('demo-book-')
    expect(created.is_sample).toBe(false)
    expect(get().counts().total).toBe(101)
    // demo-loc-3 had positions 0..32 → new one is 33.
    expect(created.shelf_position).toBe(33)
  })

  it('updateBook patches only provided fields', () => {
    const get = useDemoStore.getState
    const updated = get().updateBook('demo-book-01', { reading_status: 'reading' })
    expect(updated?.reading_status).toBe('reading')
    expect(updated?.title).toBe('Proměna')
    // demo-book-01 (Proměna) was 'read'; flipping it to 'reading' makes 11 → 12.
    expect(get().counts().reading).toBe(12)
  })

  it('deleteBook and bulkDelete remove rows', () => {
    const get = useDemoStore.getState
    get().deleteBook('demo-book-01')
    expect(get().counts().total).toBe(99)
    get().bulkDelete(['demo-book-02', 'demo-book-03'])
    expect(get().counts().total).toBe(97)
  })

  it('bulkMove and bulkUpdateStatus mutate in place', () => {
    const get = useDemoStore.getState
    get().bulkMove(['demo-book-01'], 'demo-loc-3')
    expect(get().booksByLocation('demo-loc-3').some((b) => b.id === 'demo-book-01')).toBe(true)
    get().bulkUpdateStatus(['demo-book-12'], 'lent')
    expect(get().counts().lent).toBe(1)
  })

  it('reorder applies new location and shelf_position', () => {
    const get = useDemoStore.getState
    get().reorder([{ id: 'demo-book-16', location_id: 'demo-loc-1', shelf_position: 99 }])
    const moved = get().books.find((b) => b.id === 'demo-book-16')
    expect(moved?.location_id).toBe('demo-loc-1')
    expect(moved?.shelf_position).toBe(99)
  })

  it('booksForShelf orders by location display_order then shelf_position', () => {
    const shelf = useDemoStore.getState().booksForShelf()
    expect(shelf[0].location_id).toBe('demo-loc-1')
    expect(shelf[0].shelf_position).toBe(0)
  })

  it('confirmShelfScan (replace) swaps out the shelf and adds non-sample books', () => {
    const get = useDemoStore.getState
    // demo-loc-1 seeds 34 books; replace mode should leave only the scanned ones.
    const res = get().confirmShelfScan({
      location_id: 'demo-loc-1',
      append_after_book_id: null,
      books: [
        { position: 0, title: 'Krakatit', author: 'Karel Čapek', isbn: null },
        { position: 1, title: 'Saturnin', author: 'Zdeněk Jirotka', isbn: null },
      ],
    })
    expect(res.created_count).toBe(2)
    expect(res.book_ids).toHaveLength(2)
    const shelf = get().booksByLocation('demo-loc-1')
    expect(shelf.map((b) => b.title)).toEqual(['Krakatit', 'Saturnin'])
    expect(shelf.every((b) => b.is_sample === false)).toBe(true)
    expect(shelf.map((b) => b.shelf_position)).toEqual([0, 1])
  })

  it('confirmShelfScan (append-right) inserts after the anchor and shifts the rest', () => {
    const get = useDemoStore.getState
    // Anchor on demo-loc-1 position 0 (shelf_position 0); insert 1 book after it.
    const anchor = get().booksByLocation('demo-loc-1')[0]
    get().confirmShelfScan({
      location_id: 'demo-loc-1',
      append_after_book_id: anchor.id,
      books: [{ position: 0, title: 'Inserted', author: null, isbn: null }],
    })
    const shelf = get().booksByLocation('demo-loc-1')
    // 34 seeded + 1 inserted, contiguous positions, inserted sits at index 1.
    expect(shelf).toHaveLength(35)
    expect(shelf[0].id).toBe(anchor.id)
    expect(shelf[1].title).toBe('Inserted')
    expect(shelf[1].shelf_position).toBe(1)
  })

  it('persists to sessionStorage and reset() returns to pristine seed', () => {
    const get = useDemoStore.getState
    get().addBook({ title: 'Throwaway' })
    expect(get().counts().total).toBe(101)
    // Persisted as text-only data under the demo key.
    const raw = sessionStorage.getItem(DEMO_STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(raw).toContain('Throwaway')
    get().reset()
    expect(get().counts().total).toBe(100)
    expect(get().books.every((b) => b.is_sample)).toBe(true)
  })
})

describe('demo borrowers & loans', () => {
  it('seeds borrowers with derived loan aggregates', () => {
    const get = useDemoStore.getState
    const res = get().queryBorrowers()
    expect(res.total).toBe(4)
    // Sorted by name; Jana has 2 active + 1 returned = 3 total.
    const jana = res.items.find((b) => b.id === 'demo-borrower-1')!
    expect(jana.active_loans).toBe(2)
    expect(jana.total_loans).toBe(3)
    expect(jana.last_activity_at).toBe('2026-06-02')
  })

  it('filters borrowers by search and active status', () => {
    const get = useDemoStore.getState
    expect(get().queryBorrowers({ search: 'svoboda' }).total).toBe(1)
    expect(get().queryBorrowers({ search: 'email.cz' }).total).toBe(2)
    // Tomáš has only a returned loan, so he drops out of the "active" filter.
    const active = get().queryBorrowers({ status: 'active' })
    expect(active.items.map((b) => b.id)).not.toContain('demo-borrower-4')
    // No anonymization in the demo → the pending recovery view is always empty.
    expect(get().queryBorrowers({ status: 'pending' }).total).toBe(0)
  })

  it('marks actively-lent seed books as currently lent', () => {
    const get = useDemoStore.getState
    const hobit = get().books.find((b) => b.id === 'demo-book-06')!
    expect(hobit.is_currently_lent).toBe(true)
    expect(hobit.active_loan?.borrower_id).toBe('demo-borrower-1')
    // A returned-loan book is not currently lent.
    expect(get().books.find((b) => b.id === 'demo-book-71')!.is_currently_lent).toBe(false)
  })

  it('builds borrower loan rows with joined book titles', () => {
    const get = useDemoStore.getState
    const rows = get().borrowerLoans('demo-borrower-1')
    expect(rows).toHaveLength(3)
    expect(rows.find((r) => r.book_id === 'demo-book-06')!.book_title).toBe('Hobit')
  })

  it('lends a book to an existing borrower and updates the book', () => {
    const get = useDemoStore.getState
    const loan = get().createLoan('demo-book-02', {
      borrower_id: 'demo-borrower-2',
      lent_date: '2026-06-08',
      due_date: '2026-07-08',
      notes: null,
    })
    expect(loan.is_active).toBe(true)
    expect(loan.borrower_name).toBe('Petr Svoboda')
    const book = get().books.find((b) => b.id === 'demo-book-02')!
    expect(book.is_currently_lent).toBe(true)
    expect(book.active_loan?.id).toBe(loan.id)
    // No new borrower created when linking an existing one.
    expect(get().queryBorrowers().total).toBe(4)
  })

  it('lends to a new typed-name borrower (creates the borrower)', () => {
    const get = useDemoStore.getState
    get().createLoan('demo-book-03', {
      borrower_name: 'Nový Čtenář',
      borrower_contact: 'novy@email.cz',
      lent_date: '2026-06-08',
      notes: null,
    })
    const res = get().queryBorrowers({ search: 'Nový' })
    expect(res.total).toBe(1)
    expect(res.items[0].contact).toBe('novy@email.cz')
    expect(res.items[0].active_loans).toBe(1)
  })

  it('returns a loan and frees the book', () => {
    const get = useDemoStore.getState
    get().returnLoan('demo-book-06', 'demo-loan-1', {
      returned_date: '2026-06-08',
      return_condition: 'good',
      notes: 'Vráceno.',
    })
    const loan = get().loansForBook('demo-book-06').find((l) => l.id === 'demo-loan-1')!
    expect(loan.is_active).toBe(false)
    expect(loan.returned_date).toBe('2026-06-08')
    expect(get().books.find((b) => b.id === 'demo-book-06')!.is_currently_lent).toBe(false)
    // Jana now has one fewer active loan.
    expect(get().queryBorrowers().items.find((b) => b.id === 'demo-borrower-1')!.active_loans).toBe(1)
  })

  it('edits a borrower and refreshes nested loan references without rewriting snapshots', () => {
    const get = useDemoStore.getState
    get().updateBorrower('demo-borrower-3', { name: 'Lucie Nová', contact: 'lucie.nova@email.cz', notes: 'Sestřenice.' })
    expect(get().getBorrowerDetail('demo-borrower-3')!.name).toBe('Lucie Nová')
    const loan = get().loansForBook('demo-book-01').find((l) => l.borrower_id === 'demo-borrower-3')!
    // Nested borrower reflects the edit (live resolution)...
    expect(loan.borrower?.name).toBe('Lucie Nová')
    // ...but the denormalized snapshot column is left intact (ADR 008).
    expect(loan.borrower_name).toBe('Lucie Dvořáková')
  })

  it('persists borrowers/loans and reset() restores the pristine seed', () => {
    const get = useDemoStore.getState
    get().createLoan('demo-book-05', { borrower_name: 'Throwaway Reader', lent_date: '2026-06-08', notes: null })
    const raw = sessionStorage.getItem(DEMO_STORAGE_KEY)!
    expect(raw).toContain('Throwaway Reader')
    expect(raw).toContain('demo-loan-1')
    get().reset()
    expect(get().queryBorrowers().total).toBe(4)
    expect(get().loansForBook('demo-book-05')).toHaveLength(0)
  })
})
