import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ScanShelfPage } from './ScanShelfPage'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const confirmMutateSpy = vi.fn()

vi.mock('../hooks/useScan', () => ({
  useScanShelf: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useShelfScanResult: vi.fn(() => ({ data: null })),
  useConfirmShelfScan: vi.fn(() => ({ mutate: confirmMutateSpy, isPending: false })),
  useBooksByLocation: vi.fn(() => ({ data: [] })),
}))

vi.mock('../hooks/useLocations', () => ({
  useLocations: vi.fn(() => ({
    data: [
      {
        id: 'loc-1',
        room: 'Living Room',
        furniture: 'Bookshelf',
        shelf: 'Shelf 1',
        display_order: 0,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ],
  })),
  useCreateLocation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

vi.mock('../lib/analytics', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('../lib/toast-store', () => ({
  useToastStore: vi.fn((selector: (s: { showError: () => void }) => unknown) =>
    selector({ showError: vi.fn() }),
  ),
}))

// ── Constants ─────────────────────────────────────────────────────────────────

const SCAN_DRAFT_KEY = 'shelfy:scan-shelf-draft:v1'

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

function makeReviewBook(overrides: {
  localId: string
  position: number
  title: string
  author?: string | null
  isbn?: string | null
  isManual?: boolean
}) {
  return {
    localId: overrides.localId,
    position: overrides.position,
    title: overrides.title,
    author: overrides.author ?? null,
    isbn: overrides.isbn ?? null,
    observedText: null,
    confidence: null,
    isManual: overrides.isManual ?? false,
  }
}

function setReviewDraft(books: ReturnType<typeof makeReviewBook>[]) {
  const draft = {
    version: 1,
    step: 'review',
    selRoom: 'Living Room',
    selFurniture: 'Bookshelf',
    selShelf: 'Shelf 1',
    newRoom: '',
    newFurniture: '',
    newShelf: '',
    showNewLocation: false,
    segments: [],
    editableBooks: books,
    locationId: 'loc-1',
    scanMode: 'replace',
    appendAfterBookId: null,
    savedAt: new Date().toISOString(),
  }
  localStorage.setItem(SCAN_DRAFT_KEY, JSON.stringify(draft))
}

async function restoreDraft() {
  await userEvent.click(screen.getByText('scan.restore_draft'))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ScanShelfPage – review step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('inserts a manual card between two existing scanned cards', async () => {
    setReviewDraft([
      makeReviewBook({ localId: 'a', position: 0, title: 'Book A' }),
      makeReviewBook({ localId: 'b', position: 1, title: 'Book B' }),
    ])
    renderWithProviders(<ScanShelfPage />)
    await restoreDraft()

    // There should be 3 insert buttons: top, after A, after B
    const insertButtons = screen.getAllByRole('button', { name: 'scan.add_book_here' })
    expect(insertButtons).toHaveLength(3)

    // Click the second insert button (after Book A, before Book B)
    await userEvent.click(insertButtons[1])

    // Now 3 cards: Book A, new manual, Book B
    const titleInputs = screen.getAllByPlaceholderText('scan.book_title_placeholder')
    expect(titleInputs).toHaveLength(3)
    expect(titleInputs[0]).toHaveValue('Book A')
    expect(titleInputs[1]).toHaveValue('')
    expect(titleInputs[2]).toHaveValue('Book B')
  })

  it('inserts a manual card at the top when clicking the first insert button', async () => {
    setReviewDraft([
      makeReviewBook({ localId: 'a', position: 0, title: 'Only Book' }),
    ])
    renderWithProviders(<ScanShelfPage />)
    await restoreDraft()

    const insertButtons = screen.getAllByRole('button', { name: 'scan.add_book_here' })
    // First button = insert at top
    await userEvent.click(insertButtons[0])

    const titleInputs = screen.getAllByPlaceholderText('scan.book_title_placeholder')
    expect(titleInputs).toHaveLength(2)
    expect(titleInputs[0]).toHaveValue('')       // new manual card at top
    expect(titleInputs[1]).toHaveValue('Only Book')
  })

  it('moves a card up when clicking the move-up button', async () => {
    setReviewDraft([
      makeReviewBook({ localId: 'a', position: 0, title: 'First' }),
      makeReviewBook({ localId: 'b', position: 1, title: 'Second' }),
    ])
    renderWithProviders(<ScanShelfPage />)
    await restoreDraft()

    const titleInputs = screen.getAllByPlaceholderText('scan.book_title_placeholder')
    expect(titleInputs[0]).toHaveValue('First')
    expect(titleInputs[1]).toHaveValue('Second')

    // Move "Second" up — it's the second card, so its move-up button is index 1
    const moveUpButtons = screen.getAllByRole('button', { name: 'scan.move_up' })
    await userEvent.click(moveUpButtons[1])

    const updatedInputs = screen.getAllByPlaceholderText('scan.book_title_placeholder')
    expect(updatedInputs[0]).toHaveValue('Second')
    expect(updatedInputs[1]).toHaveValue('First')
  })

  it('moves a card down when clicking the move-down button', async () => {
    setReviewDraft([
      makeReviewBook({ localId: 'a', position: 0, title: 'Alpha' }),
      makeReviewBook({ localId: 'b', position: 1, title: 'Beta' }),
      makeReviewBook({ localId: 'c', position: 2, title: 'Gamma' }),
    ])
    renderWithProviders(<ScanShelfPage />)
    await restoreDraft()

    // Move "Alpha" (first card) down
    const moveDownButtons = screen.getAllByRole('button', { name: 'scan.move_down' })
    await userEvent.click(moveDownButtons[0])

    const inputs = screen.getAllByPlaceholderText('scan.book_title_placeholder')
    expect(inputs[0]).toHaveValue('Beta')
    expect(inputs[1]).toHaveValue('Alpha')
    expect(inputs[2]).toHaveValue('Gamma')
  })

  it('sends books in display order with normalized positions on save', async () => {
    setReviewDraft([
      makeReviewBook({ localId: 'a', position: 0, title: 'Alpha' }),
      makeReviewBook({ localId: 'b', position: 1, title: 'Beta' }),
    ])
    renderWithProviders(<ScanShelfPage />)
    await restoreDraft()

    // Swap: move Beta up to position 0
    const moveUpButtons = screen.getAllByRole('button', { name: 'scan.move_up' })
    await userEvent.click(moveUpButtons[1]) // Beta's move-up button

    // Save
    await userEvent.click(screen.getByRole('button', { name: 'scan.confirm_books' }))

    expect(confirmMutateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        location_id: 'loc-1',
        books: [
          { position: 0, title: 'Beta', author: null, isbn: null },
          { position: 1, title: 'Alpha', author: null, isbn: null },
        ],
      }),
      expect.any(Object),
    )
  })

  it('includes manually inserted cards in the save payload', async () => {
    setReviewDraft([
      makeReviewBook({ localId: 'a', position: 0, title: 'Existing' }),
    ])
    renderWithProviders(<ScanShelfPage />)
    await restoreDraft()

    // Insert a new card at the top
    const insertButtons = screen.getAllByRole('button', { name: 'scan.add_book_here' })
    await userEvent.click(insertButtons[0])

    // Type a title in the new empty card (first input after insert)
    const titleInputs = screen.getAllByPlaceholderText('scan.book_title_placeholder')
    await userEvent.type(titleInputs[0], 'New Manual Book')

    // Save
    await userEvent.click(screen.getByRole('button', { name: 'scan.confirm_books' }))

    expect(confirmMutateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        books: expect.arrayContaining([
          expect.objectContaining({ title: 'New Manual Book', position: 0 }),
          expect.objectContaining({ title: 'Existing', position: 1 }),
        ]),
      }),
      expect.any(Object),
    )
  })

  it('move-up button is disabled for the first card', async () => {
    setReviewDraft([
      makeReviewBook({ localId: 'a', position: 0, title: 'Only' }),
    ])
    renderWithProviders(<ScanShelfPage />)
    await restoreDraft()

    const moveUpButtons = screen.getAllByRole('button', { name: 'scan.move_up' })
    expect(moveUpButtons[0]).toBeDisabled()
  })

  it('move-down button is disabled for the last card', async () => {
    setReviewDraft([
      makeReviewBook({ localId: 'a', position: 0, title: 'Only' }),
    ])
    renderWithProviders(<ScanShelfPage />)
    await restoreDraft()

    const moveDownButtons = screen.getAllByRole('button', { name: 'scan.move_down' })
    expect(moveDownButtons[0]).toBeDisabled()
  })

  it('renders the added_manually badge for inserted cards', async () => {
    setReviewDraft([
      makeReviewBook({ localId: 'a', position: 0, title: 'AI Book' }),
    ])
    renderWithProviders(<ScanShelfPage />)
    await restoreDraft()

    // Insert at top
    const insertButtons = screen.getAllByRole('button', { name: 'scan.add_book_here' })
    await userEvent.click(insertButtons[0])

    // The new card should show the "added_manually" badge
    expect(screen.getByText('scan.added_manually')).toBeInTheDocument()
  })

  it('shows within a card context', async () => {
    setReviewDraft([
      makeReviewBook({ localId: 'a', position: 0, title: 'Alpha' }),
      makeReviewBook({ localId: 'b', position: 1, title: 'Beta' }),
      makeReviewBook({ localId: 'c', position: 2, title: 'Gamma' }),
    ])
    renderWithProviders(<ScanShelfPage />)
    await restoreDraft()

    // Insert between Beta and Gamma
    const insertButtons = screen.getAllByRole('button', { name: 'scan.add_book_here' })
    // Buttons: [top, after Alpha, after Beta, after Gamma]
    await userEvent.click(insertButtons[2]) // after Beta

    const inputs = screen.getAllByPlaceholderText('scan.book_title_placeholder')
    expect(inputs).toHaveLength(4)
    expect(inputs[0]).toHaveValue('Alpha')
    expect(inputs[1]).toHaveValue('Beta')
    expect(inputs[2]).toHaveValue('')      // new manual card
    expect(inputs[3]).toHaveValue('Gamma')

    // The new card's position badge should read #3
    const cards = screen.getAllByText(/^#\d+$/)
    // cards: #1 Alpha, #2 Beta, #3 manual, #4 Gamma
    expect(cards.map(el => el.textContent)).toEqual(['#1', '#2', '#3', '#4'])

    // Edit the new card title
    await userEvent.type(inputs[2], 'Inserted')

    // Verify positions are correct in payload
    await userEvent.click(screen.getByRole('button', { name: 'scan.confirm_books' }))
    const [[payload]] = confirmMutateSpy.mock.calls
    expect(payload.books).toEqual([
      { position: 0, title: 'Alpha', author: null, isbn: null },
      { position: 1, title: 'Beta', author: null, isbn: null },
      { position: 2, title: 'Inserted', author: null, isbn: null },
      { position: 3, title: 'Gamma', author: null, isbn: null },
    ])
  })
})
