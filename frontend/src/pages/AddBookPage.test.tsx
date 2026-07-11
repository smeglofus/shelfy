import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockCreateMutate = vi.fn()

vi.mock('../hooks/useBooks', () => ({
  useCreateBook: () => ({ mutate: mockCreateMutate, isPending: false }),
  useUploadBookImage: () => ({ mutate: vi.fn(), isPending: false }),
  useJobStatus: () => ({ data: undefined }),
}))

vi.mock('../hooks/useLocations', () => ({
  useLocations: () => ({ data: [] }),
}))

const mockUseIsDemoMode = vi.fn(() => false)
vi.mock('../features/demo/DemoContext', () => ({
  useIsDemoMode: () => mockUseIsDemoMode(),
}))

vi.mock('../features/demo/demoNav', () => ({
  useAppNavigate: () => vi.fn(),
}))

vi.mock('../features/demo/useDemoActivity', () => ({
  useDemoActivity: { getState: () => ({ recordAdd: vi.fn(() => 0) }) },
}))

vi.mock('../lib/demoAnalytics', () => ({
  trackDemoAddBook: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  suggestBooks: vi.fn(),
}))

import { suggestBooks } from '../lib/api'
import type { BookSuggestion } from '../lib/types'
import { AddBookPage } from './AddBookPage'

const DUNE: BookSuggestion = {
  title: 'Dune',
  author: 'Frank Herbert',
  isbn: '9780441172719',
  publisher: 'Ace Books',
  language: 'eng',
  publication_year: 1965,
  cover_image_url: 'https://covers.openlibrary.org/b/id/11481354-L.jpg',
  provider: 'open_library',
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AddBookPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function titleInput(): HTMLInputElement {
  return screen.getByTestId('add-book-title-input')
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockUseIsDemoMode.mockReturnValue(false)
})

describe('AddBookPage title autocomplete (#308)', () => {
  it('queries the catalogue after 3+ typed characters and shows suggestions', async () => {
    vi.mocked(suggestBooks).mockResolvedValue([DUNE])
    renderPage()

    const user = userEvent.setup()
    await user.type(titleInput(), 'dun')

    // 250ms debounce settles inside waitFor's default budget.
    await waitFor(() => {
      expect(screen.getByTestId('add-book-suggestions')).toBeInTheDocument()
    })
    expect(suggestBooks).toHaveBeenCalledWith('dun')
    expect(screen.getByTestId('add-book-suggestion-0')).toHaveTextContent('Dune')
    expect(titleInput()).toHaveAttribute('aria-expanded', 'true')
  })

  it('does not query for fewer than 3 characters', async () => {
    vi.mocked(suggestBooks).mockResolvedValue([DUNE])
    renderPage()

    const user = userEvent.setup()
    await user.type(titleInput(), 'du')
    // Give the debounce comfortably more than 250ms to prove nothing fires.
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(suggestBooks).not.toHaveBeenCalled()
    expect(screen.queryByTestId('add-book-suggestions')).not.toBeInTheDocument()
  })

  it('never queries the catalogue in demo mode', async () => {
    mockUseIsDemoMode.mockReturnValue(true)
    vi.mocked(suggestBooks).mockResolvedValue([DUNE])
    renderPage()

    const user = userEvent.setup()
    await user.type(titleInput(), 'dune')
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(suggestBooks).not.toHaveBeenCalled()
    expect(screen.queryByTestId('add-book-suggestions')).not.toBeInTheDocument()
  })

  it('prefills the visible fields and sends silent metadata on submit after a click pick', async () => {
    vi.mocked(suggestBooks).mockResolvedValue([DUNE])
    renderPage()

    const user = userEvent.setup()
    await user.type(titleInput(), 'dun')
    await waitFor(() => {
      expect(screen.getByTestId('add-book-suggestion-0')).toBeInTheDocument()
    })

    // Selection happens on mousedown so it beats the input blur.
    await user.pointer([
      { keys: '[MouseLeft>]', target: screen.getByTestId('add-book-suggestion-0') },
      { keys: '[/MouseLeft]' },
    ])

    expect(titleInput()).toHaveValue('Dune')
    expect(screen.getByPlaceholderText('add_book.author_placeholder')).toHaveValue('Frank Herbert')
    expect(screen.getByPlaceholderText('add_book.isbn_placeholder')).toHaveValue('9780441172719')
    expect(screen.queryByTestId('add-book-suggestions')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'add_book.submit' }))

    expect(mockCreateMutate).toHaveBeenCalledTimes(1)
    expect(mockCreateMutate.mock.calls[0][0]).toMatchObject({
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: '9780441172719',
      publisher: 'Ace Books',
      language: 'eng',
      publication_year: 1965,
      cover_image_url: 'https://covers.openlibrary.org/b/id/11481354-L.jpg',
    })
  })

  it('supports keyboard selection (ArrowDown + Enter) and Escape to close', async () => {
    vi.mocked(suggestBooks).mockResolvedValue([DUNE])
    renderPage()

    const user = userEvent.setup()
    await user.type(titleInput(), 'dun')
    await waitFor(() => {
      expect(screen.getByTestId('add-book-suggestions')).toBeInTheDocument()
    })

    await user.keyboard('{ArrowDown}')
    expect(screen.getByTestId('add-book-suggestion-0')).toHaveAttribute('aria-selected', 'true')
    expect(titleInput()).toHaveAttribute(
      'aria-activedescendant',
      'add-book-suggestion-0',
    )

    await user.keyboard('{Enter}')
    expect(titleInput()).toHaveValue('Dune')
    expect(screen.getByPlaceholderText('add_book.author_placeholder')).toHaveValue('Frank Herbert')
    // Enter on an active option must pick, not submit the form.
    expect(mockCreateMutate).not.toHaveBeenCalled()

    // Reopen by editing, then Escape closes without changing the value.
    await user.type(titleInput(), 'x')
    await waitFor(() => {
      expect(screen.getByTestId('add-book-suggestions')).toBeInTheDocument()
    })
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('add-book-suggestions')).not.toBeInTheDocument()
    expect(titleInput()).toHaveValue('Dunex')
  })

  it('drops silent metadata again when the title is edited after a pick', async () => {
    vi.mocked(suggestBooks).mockResolvedValue([DUNE])
    renderPage()

    const user = userEvent.setup()
    await user.type(titleInput(), 'dun')
    await waitFor(() => {
      expect(screen.getByTestId('add-book-suggestion-0')).toBeInTheDocument()
    })
    await user.pointer([
      { keys: '[MouseLeft>]', target: screen.getByTestId('add-book-suggestion-0') },
      { keys: '[/MouseLeft]' },
    ])
    expect(titleInput()).toHaveValue('Dune')

    await user.type(titleInput(), ' II')
    await user.click(screen.getByRole('button', { name: 'add_book.submit' }))

    expect(mockCreateMutate).toHaveBeenCalledTimes(1)
    const payload = mockCreateMutate.mock.calls[0][0]
    expect(payload.title).toBe('Dune II')
    expect(payload.publication_year).toBeUndefined()
    expect(payload.cover_image_url).toBeUndefined()
  })
})
