import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true })),
}))

vi.mock('../store/useLibraryStore', () => ({
  useLibraryStore: vi.fn((selector: (s: { activeLibraryId: string | null }) => unknown) =>
    selector({ activeLibraryId: 'lib-1' })),
}))

vi.mock('../lib/api', () => ({
  listLibraries: vi.fn(),
  listWishlist: vi.fn(),
  createWishlistItem: vi.fn(),
  deleteWishlistItem: vi.fn(),
  updateLibrary: vi.fn(),
  suggestBooks: vi.fn(),
}))

// The acquire modal creates the book through the shared hooks — mocked so
// this suite doesn't have to re-enumerate the whole books API surface.
const mockCreateBookMutate = vi.fn()
vi.mock('../hooks/useBooks', () => ({
  useCreateBook: () => ({ mutate: mockCreateBookMutate, isPending: false }),
}))
vi.mock('../hooks/useLocations', () => ({
  useLocations: () => ({
    data: [
      { id: 'loc-1', room: 'Obývák', furniture: 'Knihovna', shelf: 'Police 1' },
    ],
  }),
}))

import {
  createWishlistItem,
  deleteWishlistItem,
  listLibraries,
  listWishlist,
  suggestBooks,
} from '../lib/api'
import type { Library, WishlistItem, WishlistListResponse } from '../lib/types'
import { WishlistPage } from './WishlistPage'

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return { id: 'lib-1', name: 'Test Library', role: 'owner', wishlist_enabled: true, ...overrides }
}

function makeItem(overrides: Partial<WishlistItem> = {}): WishlistItem {
  return {
    id: 'w1',
    library_id: 'lib-1',
    created_by_user_id: 'u1',
    title: 'Duna',
    author: 'Frank Herbert',
    isbn: null,
    note: null,
    cover_image_url: null,
    publication_year: 1965,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

function makePage(items: WishlistItem[]): WishlistListResponse {
  return { total: items.length, page: 1, page_size: 20, items }
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WishlistPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WishlistPage (#309)', () => {
  it('renders wishes with title, author and year', async () => {
    vi.mocked(listLibraries).mockResolvedValue([makeLibrary()])
    vi.mocked(listWishlist).mockResolvedValue(makePage([makeItem()]))
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('wishlist-list')).toBeInTheDocument()
    })
    const row = screen.getByTestId('wishlist-item-w1')
    expect(row).toHaveTextContent('Duna')
    expect(row).toHaveTextContent('Frank Herbert')
    expect(row).toHaveTextContent('1965')
  })

  it('shows the empty state when there are no wishes', async () => {
    vi.mocked(listLibraries).mockResolvedValue([makeLibrary()])
    vi.mocked(listWishlist).mockResolvedValue(makePage([]))
    renderPage()

    expect(await screen.findByTestId('wishlist-empty')).toBeInTheDocument()
  })

  it('submits a new wish and clears the form', async () => {
    vi.mocked(listLibraries).mockResolvedValue([makeLibrary()])
    vi.mocked(listWishlist).mockResolvedValue(makePage([]))
    vi.mocked(createWishlistItem).mockResolvedValue(makeItem({ id: 'w2', title: 'Nadace' }))
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('wishlist-form')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.type(screen.getByTestId('wishlist-title-input'), 'Nadace')
    await user.type(screen.getByTestId('wishlist-author-input'), 'Isaac Asimov')
    await user.click(screen.getByTestId('wishlist-submit'))

    await waitFor(() => {
      expect(createWishlistItem).toHaveBeenCalledWith({
        title: 'Nadace',
        author: 'Isaac Asimov',
        note: null,
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('wishlist-title-input')).toHaveValue('')
    })
  })

  it('prefills from a catalogue suggestion and sends silent metadata (#308 reuse)', async () => {
    vi.mocked(listLibraries).mockResolvedValue([makeLibrary()])
    vi.mocked(listWishlist).mockResolvedValue(makePage([]))
    vi.mocked(suggestBooks).mockResolvedValue([
      {
        title: 'Duna',
        author: 'Frank Herbert',
        isbn: '9780441172719',
        publisher: 'Ace Books',
        language: 'eng',
        publication_year: 1965,
        cover_image_url: 'https://covers.openlibrary.org/b/id/11481354-L.jpg',
        provider: 'open_library',
      },
    ])
    vi.mocked(createWishlistItem).mockResolvedValue(makeItem())
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('wishlist-form')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.type(screen.getByTestId('wishlist-title-input'), 'dun')
    await waitFor(() => {
      expect(screen.getByTestId('wishlist-suggestion-0')).toBeInTheDocument()
    })
    await user.pointer([
      { keys: '[MouseLeft>]', target: screen.getByTestId('wishlist-suggestion-0') },
      { keys: '[/MouseLeft]' },
    ])

    expect(screen.getByTestId('wishlist-title-input')).toHaveValue('Duna')
    expect(screen.getByTestId('wishlist-author-input')).toHaveValue('Frank Herbert')

    await user.click(screen.getByTestId('wishlist-submit'))
    await waitFor(() => {
      expect(createWishlistItem).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Duna',
          isbn: '9780441172719',
          publication_year: 1965,
          cover_image_url: 'https://covers.openlibrary.org/b/id/11481354-L.jpg',
        }),
      )
    })
  })

  it('deletes a wish', async () => {
    vi.mocked(listLibraries).mockResolvedValue([makeLibrary()])
    vi.mocked(listWishlist).mockResolvedValue(makePage([makeItem()]))
    vi.mocked(deleteWishlistItem).mockResolvedValue(undefined)
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('wishlist-delete-w1')).toBeInTheDocument()
    })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('wishlist-delete-w1'))

    await waitFor(() => {
      expect(deleteWishlistItem).toHaveBeenCalledWith('w1')
    })
  })

  it('hides the add form and delete buttons for viewers', async () => {
    vi.mocked(listLibraries).mockResolvedValue([makeLibrary({ role: 'viewer' })])
    vi.mocked(listWishlist).mockResolvedValue(makePage([makeItem()]))
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('wishlist-list')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('wishlist-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('wishlist-delete-w1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('wishlist-acquire-w1')).not.toBeInTheDocument()
  })

  it('acquires a wish: modal prefills, creates the book with silent metadata and removes the wish', async () => {
    vi.mocked(listLibraries).mockResolvedValue([makeLibrary()])
    vi.mocked(listWishlist).mockResolvedValue(makePage([
      makeItem({
        isbn: '9780441172719',
        cover_image_url: 'https://covers.openlibrary.org/b/id/11481354-L.jpg',
      }),
    ]))
    vi.mocked(deleteWishlistItem).mockResolvedValue(undefined)
    // Simulate a successful create so the modal proceeds to the wish cleanup.
    mockCreateBookMutate.mockImplementation(
      (_payload: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    )
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('wishlist-acquire-w1')).toBeInTheDocument()
    })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('wishlist-acquire-w1'))

    // Modal prefilled from the wish.
    expect(screen.getByTestId('acquire-title-input')).toHaveValue('Duna')
    expect(screen.getByTestId('acquire-author-input')).toHaveValue('Frank Herbert')

    // Pick a location through the cascade.
    await user.selectOptions(screen.getByLabelText('add_book.room_label'), 'Obývák')
    await user.selectOptions(screen.getByLabelText('add_book.furniture_label'), 'Knihovna')
    await user.selectOptions(screen.getByLabelText('add_book.shelf_label'), 'Police 1')

    await user.click(screen.getByTestId('acquire-submit'))

    expect(mockCreateBookMutate).toHaveBeenCalledTimes(1)
    expect(mockCreateBookMutate.mock.calls[0][0]).toMatchObject({
      title: 'Duna',
      author: 'Frank Herbert',
      isbn: '9780441172719',
      publication_year: 1965,
      cover_image_url: 'https://covers.openlibrary.org/b/id/11481354-L.jpg',
      location_id: 'loc-1',
      reading_status: 'unread',
    })
    await waitFor(() => {
      expect(deleteWishlistItem).toHaveBeenCalledWith('w1')
    })
    // Modal closes after the flow completes.
    await waitFor(() => {
      expect(screen.queryByTestId('wishlist-acquire-form')).not.toBeInTheDocument()
    })
  })

  it('does not remove the wish when creating the book fails', async () => {
    vi.mocked(listLibraries).mockResolvedValue([makeLibrary()])
    vi.mocked(listWishlist).mockResolvedValue(makePage([makeItem()]))
    mockCreateBookMutate.mockImplementation(
      (_payload: unknown, opts?: { onError?: () => void }) => opts?.onError?.(),
    )
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('wishlist-acquire-w1')).toBeInTheDocument()
    })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('wishlist-acquire-w1'))
    await user.click(screen.getByTestId('acquire-submit'))

    expect(deleteWishlistItem).not.toHaveBeenCalled()
    // Modal stays open for a retry.
    expect(screen.getByTestId('wishlist-acquire-form')).toBeInTheDocument()
  })

  it('shows the disabled notice and skips fetching when wishlist is off', async () => {
    vi.mocked(listLibraries).mockResolvedValue([makeLibrary({ wishlist_enabled: false })])
    vi.mocked(listWishlist).mockResolvedValue(makePage([]))
    renderPage()

    expect(await screen.findByTestId('wishlist-disabled')).toBeInTheDocument()
    expect(screen.queryByTestId('wishlist-form')).not.toBeInTheDocument()
    expect(listWishlist).not.toHaveBeenCalled()
  })
})
