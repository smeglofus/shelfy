/**
 * Demo-mode behaviour for BookDetailPage (#288 follow-up).
 *
 * A logged-out visitor can now open a book from the demo list. The detail page
 * reads and writes the in-memory demo store (no network). AI enrichment (a
 * backend/AI call) stays suppressed, but the loan-history section IS shown —
 * the lend/return lifecycle is fully sandboxed client-side.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: false })),
}))

// Stub the API so the test fails loudly if the demo ever reaches the network.
vi.mock('../lib/api', () => ({
  getBook: vi.fn(),
  updateBook: vi.fn(),
  deleteBook: vi.fn(),
  listLocations: vi.fn(),
  enrichBook: vi.fn(),
  listLoans: vi.fn(),
  createLoan: vi.fn(),
  returnLoan: vi.fn(),
  formatApiError: (e: unknown) => String(e),
}))

vi.mock('../lib/toast-store', () => ({
  useToastStore: vi.fn(
    (selector: (s: { showError: () => void; showSuccess: () => void; showInfo: () => void }) => unknown) =>
      selector({ showError: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn() }),
  ),
}))

import * as api from '../lib/api'
import { BookDetailPage } from './BookDetailPage'
import { DemoModeProvider } from '../features/demo/DemoContext'
import { useDemoStore } from '../store/useDemoStore'

function renderDetail(bookId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/demo/books/${bookId}`]}>
        <DemoModeProvider>{children}</DemoModeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(
    <Routes>
      <Route path="/demo/books/:bookId" element={<BookDetailPage />} />
    </Routes>,
    { wrapper },
  )
}

beforeEach(() => {
  sessionStorage.clear()
  useDemoStore.getState().reset()
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  useDemoStore.getState().reset()
})

describe('BookDetailPage — demo mode', () => {
  it('renders the book from the in-memory store, hides AI enrichment, shows loan history', async () => {
    const book = useDemoStore.getState().books[0]
    renderDetail(book.id)

    expect((await screen.findAllByText(book.title)).length).toBeGreaterThan(0)
    // AI enrichment hits the backend — still hidden in the demo.
    expect(screen.queryByText('enrich.enrich_book')).not.toBeInTheDocument()
    // Loan history is now sandboxed client-side, so the section IS present.
    expect(screen.getAllByText('loans.history_title').length).toBeGreaterThan(0)
    // Never touched the network.
    expect(api.getBook).not.toHaveBeenCalled()
    expect(api.listLoans).not.toHaveBeenCalled()
  })

  it('persists metadata edits to the in-memory store, no network', async () => {
    const user = userEvent.setup()
    const book = useDemoStore.getState().books[0]
    renderDetail(book.id)
    await screen.findAllByText(book.title)

    await user.click(screen.getByText('book_detail.metadata_edit_title'))
    const titleInput = screen.getByLabelText('edit-title')
    await user.clear(titleInput)
    await user.type(titleInput, 'Nový název')
    await user.click(screen.getByText('book_detail.save'))

    await waitFor(() => {
      expect(useDemoStore.getState().books.find((b) => b.id === book.id)?.title).toBe('Nový název')
    })
    expect(api.updateBook).not.toHaveBeenCalled()
  })
})
