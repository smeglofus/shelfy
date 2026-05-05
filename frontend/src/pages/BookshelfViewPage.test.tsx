import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BookshelfViewPage } from './BookshelfViewPage'
import type { Book, Location } from '../lib/types'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../hooks/useLocations', () => ({
  useLocations: vi.fn(() => ({ data: [] })),
}))

vi.mock('../hooks/useBooks', () => ({
  useBooksForShelf: vi.fn(() => ({ data: [] })),
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

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true })),
}))

// LocationsPage is rendered on the locations tab — mock it to keep tests focused
vi.mock('./LocationsPage', () => ({
  LocationsPage: () => <div data-testid="locations-page-stub" />,
}))

import { useLocations } from '../hooks/useLocations'
import { useBooksForShelf } from '../hooks/useBooks'

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPage(url = '/bookshelf') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/bookshelf" element={<BookshelfViewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const loc1: Location = {
  id: 'loc-1',
  room: 'Living Room',
  furniture: 'Bookcase',
  shelf: 'Shelf 1',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

function makeBook(overrides?: Partial<Book>): Book {
  return {
    id: 'book-1',
    title: 'Test Book',
    author: 'Author',
    isbn: null,
    publisher: null,
    language: null,
    description: null,
    publication_year: null,
    cover_image_url: null,
    location_id: 'loc-1',
    shelf_position: 0,
    processing_status: 'done',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BookshelfViewPage', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('shows no-locations empty state with CTAs when no locations exist', () => {
    vi.mocked(useLocations).mockReturnValue({ data: [] } as ReturnType<typeof useLocations>)
    vi.mocked(useBooksForShelf).mockReturnValue({ data: [] } as ReturnType<typeof useBooksForShelf>)

    renderPage()

    expect(screen.getByTestId('bookshelf-no-locations-state')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'bookshelf.empty_cta_locations' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'bookshelf.empty_cta_scan' })).toBeInTheDocument()
  })

  it('shows no-books hint when locations exist but no books are assigned', () => {
    vi.mocked(useLocations).mockReturnValue({ data: [loc1] } as ReturnType<typeof useLocations>)
    vi.mocked(useBooksForShelf).mockReturnValue({ data: [] } as ReturnType<typeof useBooksForShelf>)

    renderPage()

    expect(screen.queryByTestId('bookshelf-no-locations-state')).not.toBeInTheDocument()
    expect(screen.getByTestId('bookshelf-no-books-hint')).toBeInTheDocument()
  })

  it('does not show empty state or hint when locations have assigned books', () => {
    vi.mocked(useLocations).mockReturnValue({ data: [loc1] } as ReturnType<typeof useLocations>)
    vi.mocked(useBooksForShelf).mockReturnValue({ data: [makeBook()] } as ReturnType<typeof useBooksForShelf>)

    renderPage()

    expect(screen.queryByTestId('bookshelf-no-locations-state')).not.toBeInTheDocument()
    expect(screen.queryByTestId('bookshelf-no-books-hint')).not.toBeInTheDocument()
  })

  it('renders the LocationsPage on the locations tab', () => {
    vi.mocked(useLocations).mockReturnValue({ data: [] } as ReturnType<typeof useLocations>)
    vi.mocked(useBooksForShelf).mockReturnValue({ data: [] } as ReturnType<typeof useBooksForShelf>)

    renderPage('/bookshelf?tab=locations')

    expect(screen.getByTestId('locations-page-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('bookshelf-no-locations-state')).not.toBeInTheDocument()
  })
})
