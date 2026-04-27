import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BooksPage } from './BooksPage'
import { useToastStore } from '../lib/toast-store'
import type { Book, Location } from '../lib/types'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../lib/api', () => ({
  listBooksForShelf: vi.fn(),
  listBooks: vi.fn(),        // kept for hook compatibility
  createBook: vi.fn(),
  updateBook: vi.fn(),
  deleteBook: vi.fn(),
  bulkDeleteBooks: vi.fn(),
  bulkMoveBooks: vi.fn(),
  bulkUpdateStatus: vi.fn(),
  listLocations: vi.fn(),
  uploadBookImage: vi.fn(),
  getJobStatus: vi.fn(),
  getOnboardingStatus: vi.fn(),
  completeOnboarding: vi.fn(),
  skipOnboarding: vi.fn(),
  resetOnboarding: vi.fn(),
  formatApiError: vi.fn(() => 'API error'),
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'user-1', email: 'test@example.com' },
    isAuthenticated: true,
    logout: vi.fn(),
  })),
}))

import {
  deleteBook,
  getOnboardingStatus,
  listBooksForShelf,
  listLocations,
} from '../lib/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeBook = (overrides: Partial<Book> = {}): Book => ({
  id: 'book-1',
  title: 'Clean Code',
  author: 'Robert C. Martin',
  isbn: '9780132350884',
  publisher: 'Prentice Hall',
  language: 'en',
  description: 'A handbook of agile software craftsmanship.',
  publication_year: 2008,
  cover_image_url: 'https://example.com/clean-code.jpg',
  location_id: 'loc-1',
  shelf_position: 0,
  reading_status: 'unread',
  processing_status: 'manual',
  is_currently_lent: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BooksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useToastStore.setState({ message: null })
    vi.mocked(listBooksForShelf).mockResolvedValue([makeBook()])
    vi.mocked(listLocations).mockResolvedValue(locations)
    vi.mocked(deleteBook).mockResolvedValue(undefined)
    vi.mocked(getOnboardingStatus).mockResolvedValue({
      should_show: false,
      completed_at: '2024-01-01T00:00:00Z',
      skipped_at: null,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders book list', async () => {
    renderWithProviders(<BooksPage />)

    expect(await screen.findByText('Clean Code')).toBeInTheDocument()
  })

  it('requires confirmation before deleting a book', async () => {
    renderWithProviders(<BooksPage />)

    await screen.findByText('Clean Code')

    await userEvent.click(screen.getByRole('button', { name: /delete-book-1/ }))

    // Modal label is the translated delete_confirm_title key
    expect(screen.getByRole('dialog', { name: 'books.delete_confirm_title' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'books.delete_confirm' }))

    await waitFor(() => {
      expect(deleteBook).toHaveBeenCalledWith('book-1')
    })
  })

  it('shows aggregated toast for failed books', async () => {
    vi.mocked(listBooksForShelf).mockResolvedValue([
      makeBook({ id: 'book-f1', title: 'Book Failed 1', processing_status: 'failed' }),
      makeBook({ id: 'book-f2', title: 'Book Failed 2', processing_status: 'failed' }),
    ])

    renderWithProviders(<BooksPage />)

    // Both books render (failed books are still listed)
    const deleteButtons = await screen.findAllByRole('button', { name: /delete-book-/ })
    expect(deleteButtons.length).toBe(2)

    // The toast store should have received an error about failed processing
    await waitFor(() => {
      const { toasts } = useToastStore.getState()
      expect(toasts.some((t) => t.message === 'books.processing_failed_bulk' && t.variant === 'error')).toBe(true)
    })
  })
})

// ── Empty-state tests (issue #130) ────────────────────────────────────────────

describe('BooksPage — empty library state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useToastStore.setState({ message: null })
    vi.mocked(listBooksForShelf).mockResolvedValue([])
    vi.mocked(listLocations).mockResolvedValue([])
    vi.mocked(getOnboardingStatus).mockResolvedValue({
      should_show: false,
      completed_at: null,
      skipped_at: null,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows onboarding empty state with primary CTA when library has zero books', async () => {
    renderWithProviders(<BooksPage />)

    expect(await screen.findByTestId('empty-library-state')).toBeInTheDocument()
    expect(screen.getByText('books.empty_title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'books.empty_cta_add' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'books.empty_cta_scan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'books.empty_cta_location' })).toBeInTheDocument()
  })

  it('does not show rich empty state when library has books', async () => {
    vi.mocked(listBooksForShelf).mockResolvedValue([makeBook()])
    vi.mocked(listLocations).mockResolvedValue(locations)

    renderWithProviders(<BooksPage />)

    await screen.findByText('Clean Code')
    expect(screen.queryByTestId('empty-library-state')).not.toBeInTheDocument()
  })
})
