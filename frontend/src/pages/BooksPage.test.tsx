import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BooksPage } from './BooksPage'
import { useToastStore } from '../lib/toast-store'
import type { BookListResponse, Location } from '../lib/types'

vi.mock('../lib/api', () => ({
  listBooks: vi.fn(),
  createBook: vi.fn(),
  updateBook: vi.fn(),
  deleteBook: vi.fn(),
  listLocations: vi.fn(),
  uploadBookImage: vi.fn(),
  getJobStatus: vi.fn(),
  getOnboardingStatus: vi.fn(),
  completeOnboarding: vi.fn(),
  skipOnboarding: vi.fn(),
  resetOnboarding: vi.fn(),
  formatApiError: vi.fn(() => 'API error'),
}))

import { deleteBook, getOnboardingStatus, listBooks, listLocations } from '../lib/api'

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

const booksResponse: BookListResponse = {
  total: 1,
  page: 1,
  page_size: 20,
  items: [
    {
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
      processing_status: 'manual',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
  ],
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

describe('BooksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useToastStore.setState({ message: null })
    vi.mocked(listBooks).mockResolvedValue(booksResponse)
    vi.mocked(listLocations).mockResolvedValue(locations)
    vi.mocked(deleteBook).mockResolvedValue()
    vi.mocked(getOnboardingStatus).mockResolvedValue({ should_show: false, completed_at: '2024-01-01T00:00:00Z', skipped_at: null })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders book list and submits search input', async () => {
    renderWithProviders(<BooksPage />)

    expect(await screen.findByRole('button', { name: /delete-book-/ })).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('books.search_label'), 'Martin')
    await userEvent.click(screen.getByRole('button', { name: 'books.search_button' }))

    await waitFor(() => {
      expect(listBooks).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Martin' }))
    })
  })

  it('requires confirmation before deleting a book', async () => {
    renderWithProviders(<BooksPage />)

    await screen.findByRole('button', { name: /delete-book-/ })

    await userEvent.click(screen.getByRole('button', { name: /delete-book-/ }))

    expect(screen.getByRole('dialog', { name: 'delete-book-dialog' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'books.delete_confirm' }))

    await waitFor(() => {
      expect(deleteBook).toHaveBeenCalledWith('book-1')
    })
  })

  it('shows aggregated toast for failed books', async () => {
    const showErrorSpy = vi.spyOn(useToastStore.getState(), 'showError')
    vi.mocked(listBooks).mockResolvedValue({
      ...booksResponse,
      total: 2,
      items: [
        { ...booksResponse.items[0], id: 'book-f1', title: 'Book Failed 1', processing_status: 'failed' },
        { ...booksResponse.items[0], id: 'book-f2', title: 'Book Failed 2', processing_status: 'failed' },
      ],
    })

    renderWithProviders(<BooksPage />)

    const deleteButtons = await screen.findAllByRole('button', { name: /delete-book-/ })
    expect(deleteButtons.length).toBe(2)

    await waitFor(() => {
      expect(showErrorSpy).toHaveBeenCalledTimes(1)
      expect(showErrorSpy).toHaveBeenCalledWith(
        'books.processing_failed_bulk',
      )
    })
  })
})
