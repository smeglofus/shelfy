import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BookDetailPage } from './BookDetailPage'
import type { Book, Location } from '../lib/types'

vi.mock('../lib/api', () => ({
  getBook: vi.fn(),
  updateBook: vi.fn(),
  deleteBook: vi.fn(),
  listLocations: vi.fn(),
  formatApiError: vi.fn(() => 'API error'),
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'user-1', email: 'test@example.com' },
    isAuthenticated: true,
    logout: vi.fn(),
  })),
}))

import { getBook, listLocations, updateBook } from '../lib/api'

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/books/book-1']}>
        <Routes>
          <Route path="/books/:bookId" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const book: Book = {
  id: 'book-1',
  title: 'Clean Architecture',
  author: 'Robert C. Martin',
  isbn: '9780134494166',
  publisher: 'Prentice Hall',
  language: 'en',
  description: 'Software architecture and design principles.',
  publication_year: 2017,
  cover_image_url: 'https://example.com/clean-architecture.jpg',
  location_id: 'loc-1',
  reading_status: 'unread',
  processing_status: 'manual',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const locations: Location[] = [
  {
    id: 'loc-1',
    room: 'Office',
    furniture: 'Bookshelf',
    shelf: 'Shelf 1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
]

describe('BookDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getBook).mockResolvedValue(book)
    vi.mocked(listLocations).mockResolvedValue(locations)
    vi.mocked(updateBook).mockImplementation(async (_id, payload) => ({
      ...book,
      ...payload,
    }))
  })

  afterEach(() => {
    cleanup()
  })

  it('renders all book metadata fields', async () => {
    renderWithProviders(<BookDetailPage />)

    expect(await screen.findByRole('heading', { name: 'Clean Architecture' })).toBeInTheDocument()
    expect(screen.getAllByText('Robert C. Martin').length).toBeGreaterThan(0)
    expect(screen.getAllByText('9780134494166').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Prentice Hall').length).toBeGreaterThan(0)
    expect(screen.getAllByText('en').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Software architecture and design principles.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2017').length).toBeGreaterThan(0)
    expect(screen.getAllByText('processing_status.manual').length).toBeGreaterThan(0)
  })

  it('submits save form with explicit unassigned location', async () => {
    renderWithProviders(<BookDetailPage />)

    await screen.findByRole('heading', { name: 'Clean Architecture' })

    await userEvent.selectOptions(screen.getByLabelText('book_detail.location_label'), '')
    await userEvent.click(screen.getByRole('button', { name: 'book_detail.save' }))

    await waitFor(() => {
      expect(updateBook).toHaveBeenCalledWith('book-1',
        expect.objectContaining({ location_id: null }))
    })
  })
})
