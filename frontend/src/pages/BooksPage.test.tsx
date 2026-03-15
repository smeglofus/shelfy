import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BooksPage } from './BooksPage'
import type { Book, BookListResponse, JobStatusResponse, Location, UploadJobResponse } from '../lib/types'

vi.mock('../lib/api', () => ({
  listBooks: vi.fn(),
  createBook: vi.fn(),
  updateBook: vi.fn(),
  deleteBook: vi.fn(),
  listLocations: vi.fn(),
  uploadBookImage: vi.fn(),
  getJobStatus: vi.fn(),
  formatApiError: vi.fn(() => 'API error'),
}))

import {
  createBook,
  deleteBook,
  getJobStatus,
  listBooks,
  listLocations,
  updateBook,
  uploadBookImage,
} from '../lib/api'

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
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
  page_size: 10,
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
    vi.mocked(listBooks).mockResolvedValue(booksResponse)
    vi.mocked(listLocations).mockResolvedValue(locations)
    vi.mocked(deleteBook).mockResolvedValue()
    vi.mocked(getJobStatus).mockResolvedValue({ id: 'job-1', status: 'pending', book_id: null } satisfies JobStatusResponse)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders book list and submits search input', async () => {
    renderWithProviders(<BooksPage />)

    expect(await screen.findByText('Clean Code')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Search books'), 'Martin')
    await userEvent.click(screen.getByRole('button', { name: 'Apply search' }))

    await waitFor(() => {
      expect(listBooks).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Martin' }))
    })
  })

  it('submits create and edit forms', async () => {
    vi.mocked(createBook).mockImplementation(async (payload) => ({
      ...(booksResponse.items[0] as Book),
      id: 'book-2',
      title: payload.title,
      author: payload.author ?? null,
    }))
    vi.mocked(updateBook).mockImplementation(async (_id, payload) => ({
      ...(booksResponse.items[0] as Book),
      ...payload,
      author: payload.author ?? booksResponse.items[0].author,
    }))

    renderWithProviders(<BooksPage />)

    await screen.findByText('Clean Code')

    await userEvent.type(screen.getByLabelText('Title'), 'Refactoring')
    await userEvent.type(screen.getByLabelText('Author'), 'Martin Fowler')
    await userEvent.click(screen.getByRole('button', { name: 'Create book' }))

    await waitFor(() => {
      expect(createBook).toHaveBeenCalledWith(expect.objectContaining({ title: 'Refactoring' }))
    })

    const cleanCodeCell = await screen.findByRole('link', { name: 'Clean Code' })
    const cleanCodeRow = cleanCodeCell.closest('tr')
    if (!cleanCodeRow) {
      throw new Error('Expected book row to exist')
    }

    await userEvent.click(within(cleanCodeRow).getByRole('button', { name: 'Edit' }))
    const editTitleInput = screen.getByLabelText('Edit title')
    await userEvent.clear(editTitleInput)
    await userEvent.type(editTitleInput, 'Clean Code 2nd Edition')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateBook).toHaveBeenCalledWith(
        'book-1',
        expect.objectContaining({ title: 'Clean Code 2nd Edition' }),
      )
    })
  })

  it('requires confirmation before deleting a book', async () => {
    renderWithProviders(<BooksPage />)

    await screen.findByText('Clean Code')
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('dialog', { name: 'delete-book-dialog' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => {
      expect(deleteBook).toHaveBeenCalledWith('book-1')
    })
  })

  it('polls job status and stops when done', async () => {
    vi.mocked(uploadBookImage).mockResolvedValue({ job_id: 'job-1', status: 'pending' } satisfies UploadJobResponse)
    vi.mocked(getJobStatus)
      .mockResolvedValueOnce({ id: 'job-1', status: 'pending', book_id: null } satisfies JobStatusResponse)
      .mockResolvedValueOnce({ id: 'job-1', status: 'done', book_id: null } satisfies JobStatusResponse)

    renderWithProviders(<BooksPage />)
    await screen.findByText('Clean Code')

    const file = new File(['img'], 'cover.png', { type: 'image/png' })
    await userEvent.upload(screen.getByLabelText('Upload book image'), file)
    await userEvent.click(screen.getByRole('button', { name: 'Upload image' }))

    await waitFor(() => expect(getJobStatus).toHaveBeenCalledTimes(2), { timeout: 7000 })

    await new Promise((resolve) => setTimeout(resolve, 2500))
    expect(getJobStatus).toHaveBeenCalledTimes(2)
  }, 10000)
})
