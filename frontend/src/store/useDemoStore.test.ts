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
  it('mirrors the backend sample set (3 shelves, 16 books) with full type fidelity', () => {
    const locations = createDemoLocations()
    const books = createDemoBooks()
    expect(locations).toHaveLength(3)
    expect(books).toHaveLength(16)
    // Every book has all required fields populated (no undefined holes).
    for (const b of books) {
      expect(b.id).toMatch(/^demo-book-\d{2}$/)
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
    expect(filterBooks(books, { search: 'tolkien' })).toHaveLength(2)
    expect(filterBooks(books, { search: 'HOBIT' }).map((b) => b.title)).toContain('Hobit')
  })

  it('filters by reading status and location', () => {
    expect(filterBooks(books, { readingStatus: 'reading' })).toHaveLength(2)
    expect(filterBooks(books, { locationId: 'demo-loc-3' })).toHaveLength(5)
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
    expect(page1.total).toBe(16)
    expect(page1.items).toHaveLength(10)
    expect(page1.has_sample_books).toBe(true)
    const page2 = get().queryBooks({ pageSize: 10, page: 2 })
    expect(page2.items).toHaveLength(6)
  })

  it('counts reflects reading statuses', () => {
    const c = useDemoStore.getState().counts()
    expect(c.total).toBe(16)
    expect(c.read).toBe(9)
    expect(c.reading).toBe(2)
    expect(c.lent).toBe(0)
  })

  it('addBook appends to the end of the target shelf', () => {
    const get = useDemoStore.getState
    const created = get().addBook({ title: 'New Book', location_id: 'demo-loc-3' })
    expect(created.id).toContain('demo-book-')
    expect(created.is_sample).toBe(false)
    expect(get().counts().total).toBe(17)
    // demo-loc-3 had positions 0..4 → new one is 5.
    expect(created.shelf_position).toBe(5)
  })

  it('updateBook patches only provided fields', () => {
    const get = useDemoStore.getState
    const updated = get().updateBook('demo-book-01', { reading_status: 'reading' })
    expect(updated?.reading_status).toBe('reading')
    expect(updated?.title).toBe('Proměna')
    expect(get().counts().reading).toBe(3)
  })

  it('deleteBook and bulkDelete remove rows', () => {
    const get = useDemoStore.getState
    get().deleteBook('demo-book-01')
    expect(get().counts().total).toBe(15)
    get().bulkDelete(['demo-book-02', 'demo-book-03'])
    expect(get().counts().total).toBe(13)
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
    // demo-loc-1 seeds 6 books; replace mode should leave only the scanned ones.
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
    // 6 seeded + 1 inserted, contiguous positions, inserted sits at index 1.
    expect(shelf).toHaveLength(7)
    expect(shelf[0].id).toBe(anchor.id)
    expect(shelf[1].title).toBe('Inserted')
    expect(shelf[1].shelf_position).toBe(1)
  })

  it('persists to sessionStorage and reset() returns to pristine seed', () => {
    const get = useDemoStore.getState
    get().addBook({ title: 'Throwaway' })
    expect(get().counts().total).toBe(17)
    // Persisted as text-only data under the demo key.
    const raw = sessionStorage.getItem(DEMO_STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(raw).toContain('Throwaway')
    get().reset()
    expect(get().counts().total).toBe(16)
    expect(get().books.every((b) => b.is_sample)).toBe(true)
  })
})
