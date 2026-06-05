/**
 * Demo-mode behaviour for BookshelfViewPage.
 *
 * Regression guard: the book-spine click handler used to short-circuit on
 * `isDemo` (a leftover from before the demo book-detail route existed), so
 * clicking a book in the bookshelf view silently did nothing for logged-out
 * visitors. It must now open the demo book-detail twin (`/demo/books/:id`).
 *
 * The data hooks are mocked (as in BookshelfViewPage.test.tsx) to keep the
 * heavy DnD page light, but the router + the real demo-aware `useAppNavigate`
 * are left intact so the test proves real `/demo`-prefixed navigation.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Book, Location } from '../lib/types'

const TS = '2026-01-01T00:00:00.000Z'

const LOC: Location = {
  id: 'demo-loc-1', room: 'Living room', furniture: 'Bookcase', shelf: 'Shelf 1',
  display_order: 1, is_sample: true, created_at: TS, updated_at: TS,
}
function spineBook(id: string, title: string, pos: number): Book {
  return {
    id, title, author: 'Test Author', isbn: null, publisher: null, language: 'cs',
    description: null, publication_year: 2000, cover_image_url: null,
    location_id: LOC.id, shelf_position: pos, processing_status: 'done',
    reading_status: 'read', is_currently_lent: false, active_loan: null,
    is_sample: true, created_at: TS, updated_at: TS,
  }
}

// Stable references — a fresh object each render would loop the page's
// `localByLocation` sync effect.
const LOCATIONS = [LOC]
const BOOKS = [spineBook('demo-book-01', 'Proměna', 0), spineBook('demo-book-02', 'Hobit', 1)]

vi.mock('../hooks/useLocations', () => ({
  useLocations: vi.fn(() => ({ data: LOCATIONS })),
}))

vi.mock('../hooks/useBooks', () => ({
  useBooksForShelf: vi.fn(() => ({ data: BOOKS })),
  useBulkMoveBooks: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

vi.mock('../lib/api', () => ({
  bulkReorderBooks: vi.fn(),
}))

vi.mock('../lib/toast-store', () => ({
  useToastStore: vi.fn(
    (selector: (s: { showError: () => void; showSuccess: () => void }) => unknown) =>
      selector({ showError: vi.fn(), showSuccess: vi.fn() }),
  ),
}))

// Logged-out visitor — the demo must not depend on auth.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: false })),
}))

vi.mock('./LocationsPage', () => ({
  LocationsPage: () => <div data-testid="locations-page-stub" />,
}))

import { BookshelfViewPage } from './BookshelfViewPage'
import { DemoModeProvider } from '../features/demo/DemoContext'

function renderDemo() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/demo/bookshelf']}>
        <DemoModeProvider>
          <Routes>
            <Route path="/demo/bookshelf" element={<BookshelfViewPage />} />
            <Route path="/demo/books/:bookId" element={<div data-testid="book-detail-landed" />} />
          </Routes>
        </DemoModeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

describe('BookshelfViewPage — demo mode', () => {
  it('opens the demo book-detail twin when a book spine is clicked', async () => {
    renderDemo()

    // A book spine renders with its title as the accessible name.
    const spine = screen.getByRole('button', { name: /Proměna/ })
    fireEvent.click(spine)

    // Navigation landed on the demo-prefixed detail route, not a dead click.
    expect(await screen.findByTestId('book-detail-landed')).toBeInTheDocument()
  })
})
