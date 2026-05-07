import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true })),
}))

vi.mock('../lib/api', () => ({
  listBorrowers: vi.fn(),
}))

import { listBorrowers } from '../lib/api'
import type { BorrowerListItem, BorrowerListResponse } from '../lib/types'
import { BorrowersPage } from './BorrowersPage'

function makeBorrower(overrides: Partial<BorrowerListItem> = {}): BorrowerListItem {
  return {
    id: 'b1',
    name: 'Alice Liddell',
    contact: 'alice@x.com',
    notes: null,
    anonymized_at: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    active_loans: 0,
    total_loans: 0,
    last_activity_at: null,
    ...overrides,
  }
}

function makePage(items: BorrowerListItem[], overrides: Partial<BorrowerListResponse> = {}): BorrowerListResponse {
  return {
    total: items.length,
    page: 1,
    page_size: 20,
    items,
    ...overrides,
  }
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BorrowersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('BorrowersPage', () => {
  it('shows the empty state when there are no borrowers', async () => {
    vi.mocked(listBorrowers).mockResolvedValue(makePage([]))
    renderPage()
    expect(await screen.findByTestId('borrowers-empty')).toBeInTheDocument()
    expect(screen.getByText('borrowers.empty_title')).toBeInTheDocument()
  })

  it('renders one row per borrower with stats and a link to the detail page', async () => {
    vi.mocked(listBorrowers).mockResolvedValue(
      makePage([
        makeBorrower({
          id: 'b-alice',
          name: 'Alice',
          active_loans: 2,
          total_loans: 5,
          last_activity_at: '2026-05-01',
        }),
        makeBorrower({
          id: 'b-bob',
          name: 'Bob',
          contact: null,
          active_loans: 0,
          total_loans: 1,
          last_activity_at: null,
        }),
      ]),
    )
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('borrowers-list')).toBeInTheDocument()
    })

    const aliceRow = screen.getByTestId('borrower-row-b-alice')
    expect(aliceRow).toHaveAttribute('href', '/borrowers/b-alice')
    expect(aliceRow).toHaveTextContent('Alice')
    expect(aliceRow).toHaveTextContent('alice@x.com')

    const bobRow = screen.getByTestId('borrower-row-b-bob')
    expect(bobRow).toHaveAttribute('href', '/borrowers/b-bob')

    expect(screen.getByTestId('borrower-active-b-alice')).toBeInTheDocument()
    expect(screen.getByTestId('borrower-total-b-alice')).toBeInTheDocument()
    expect(screen.getByTestId('borrower-last-b-alice')).toBeInTheDocument()
    expect(screen.getByTestId('borrower-last-b-bob')).toHaveTextContent('borrowers.no_activity')
  })

  it('passes the typed (debounced) search string through to listBorrowers', async () => {
    vi.mocked(listBorrowers).mockResolvedValue(makePage([]))
    renderPage()
    await waitFor(() => expect(listBorrowers).toHaveBeenCalled())

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('borrowers.search_placeholder'), 'alice')

    // The 250ms debounce settles within waitFor's default 1s budget.
    await waitFor(() => {
      const calls = vi.mocked(listBorrowers).mock.calls
      const seenSearches = calls.map(([params]) => params?.search)
      expect(seenSearches).toContain('alice')
    })
  })

  it('shows the no-results state when search returns nothing', async () => {
    vi.mocked(listBorrowers).mockResolvedValue(makePage([]))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('borrowers-empty')).toBeInTheDocument())

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('borrowers.search_placeholder'), 'zzz')

    await waitFor(() => {
      expect(screen.getByTestId('borrowers-no-results')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('borrowers-empty')).not.toBeInTheDocument()
  })

  it('renders the localized label for an anonymized borrower', async () => {
    vi.mocked(listBorrowers).mockResolvedValue(
      makePage([
        makeBorrower({
          id: 'b-anon',
          name: 'Deleted borrower',
          contact: null,
          anonymized_at: '2026-05-07T00:00:00Z',
        }),
      ]),
    )
    renderPage()

    await waitFor(() => expect(screen.getByTestId('borrowers-list')).toBeInTheDocument())
    const row = screen.getByTestId('borrower-row-b-anon')
    expect(row).toHaveTextContent('borrowers.anonymized_label')
  })

  it('shows the paginator when total exceeds page size and advances pages', async () => {
    // First call (page 1) returns 20 borrowers + total 25.
    // Second call (page 2) returns the remaining 5.
    vi.mocked(listBorrowers).mockImplementation(async (params) => {
      const page = params?.page ?? 1
      const items = page === 1
        ? Array.from({ length: 20 }, (_, i) => makeBorrower({ id: `p1-${i}`, name: `A${i}` }))
        : Array.from({ length: 5 }, (_, i) => makeBorrower({ id: `p2-${i}`, name: `B${i}` }))
      return makePage(items, { total: 25, page, page_size: 20 })
    })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('borrowers-paginator')).toBeInTheDocument())
    expect(screen.getByTestId('borrowers-prev-page')).toBeDisabled()
    expect(screen.getByTestId('borrowers-next-page')).not.toBeDisabled()

    const user = userEvent.setup()
    await user.click(screen.getByTestId('borrowers-next-page'))

    await waitFor(() => {
      const lastCall = vi.mocked(listBorrowers).mock.calls[vi.mocked(listBorrowers).mock.calls.length - 1]
      expect(lastCall?.[0]?.page).toBe(2)
    })
    await waitFor(() => {
      expect(screen.getByTestId('borrowers-next-page')).toBeDisabled()
    })
  })

  it('does not show the paginator when total fits on a single page', async () => {
    vi.mocked(listBorrowers).mockResolvedValue(
      makePage([makeBorrower({ id: 'only-one', name: 'Solo' })]),
    )
    renderPage()
    await waitFor(() => expect(screen.getByTestId('borrowers-list')).toBeInTheDocument())
    expect(screen.queryByTestId('borrowers-paginator')).not.toBeInTheDocument()
  })

  it('resets back to page 1 when the search query changes', async () => {
    vi.mocked(listBorrowers).mockImplementation(async (params) => {
      const page = params?.page ?? 1
      const search = params?.search ?? ''
      const items = page === 2 && !search
        ? Array.from({ length: 5 }, (_, i) => makeBorrower({ id: `p2-${i}`, name: `B${i}` }))
        : Array.from({ length: 20 }, (_, i) => makeBorrower({ id: `${search}-${page}-${i}`, name: `X${i}` }))
      return makePage(items, { total: search ? 20 : 25, page, page_size: 20 })
    })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('borrowers-paginator')).toBeInTheDocument())

    const user = userEvent.setup()
    await user.click(screen.getByTestId('borrowers-next-page'))

    await waitFor(() => {
      const lastCall = vi.mocked(listBorrowers).mock.calls[vi.mocked(listBorrowers).mock.calls.length - 1]
      expect(lastCall?.[0]?.page).toBe(2)
    })

    // Typing a search query should snap us back to page 1.
    await user.type(screen.getByPlaceholderText('borrowers.search_placeholder'), 'q')

    await waitFor(() => {
      const lastCall = vi.mocked(listBorrowers).mock.calls[vi.mocked(listBorrowers).mock.calls.length - 1]
      expect(lastCall?.[0]?.page).toBe(1)
      expect(lastCall?.[0]?.search).toBe('q')
    })
  })
})
