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
import type { BorrowerListItem } from '../lib/types'
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
    vi.mocked(listBorrowers).mockResolvedValue([])
    renderPage()
    expect(await screen.findByTestId('borrowers-empty')).toBeInTheDocument()
    expect(screen.getByText('borrowers.empty_title')).toBeInTheDocument()
  })

  it('renders one row per borrower with stats and a link to the detail page', async () => {
    vi.mocked(listBorrowers).mockResolvedValue([
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
    ])
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

    // Stats labels (i18n mock returns keys, so check via testid presence)
    expect(screen.getByTestId('borrower-active-b-alice')).toBeInTheDocument()
    expect(screen.getByTestId('borrower-total-b-alice')).toBeInTheDocument()
    expect(screen.getByTestId('borrower-last-b-alice')).toBeInTheDocument()
    expect(screen.getByTestId('borrower-last-b-bob')).toHaveTextContent('borrowers.no_activity')
  })

  it('filters the list by name with a case-insensitive substring search', async () => {
    vi.mocked(listBorrowers).mockResolvedValue([
      makeBorrower({ id: 'b-alice', name: 'Alice Liddell' }),
      makeBorrower({ id: 'b-bob', name: 'Bob Builder' }),
      makeBorrower({ id: 'b-carol', name: 'Carol Danvers' }),
    ])
    renderPage()

    await waitFor(() => expect(screen.getByTestId('borrowers-list')).toBeInTheDocument())

    const user = userEvent.setup()
    const searchBox = screen.getByPlaceholderText('borrowers.search_placeholder')
    await user.type(searchBox, 'BOB')

    expect(screen.queryByTestId('borrower-row-b-alice')).not.toBeInTheDocument()
    expect(screen.getByTestId('borrower-row-b-bob')).toBeInTheDocument()
    expect(screen.queryByTestId('borrower-row-b-carol')).not.toBeInTheDocument()
  })

  it('shows a no-results message when the search matches nothing', async () => {
    vi.mocked(listBorrowers).mockResolvedValue([
      makeBorrower({ id: 'b-alice', name: 'Alice' }),
    ])
    renderPage()

    await waitFor(() => expect(screen.getByTestId('borrowers-list')).toBeInTheDocument())

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('borrowers.search_placeholder'), 'zzz')

    expect(screen.getByTestId('borrowers-no-results')).toBeInTheDocument()
    expect(screen.queryByTestId('borrowers-empty')).not.toBeInTheDocument()
  })

  it('renders the localized label for an anonymized borrower instead of the DB name', async () => {
    vi.mocked(listBorrowers).mockResolvedValue([
      makeBorrower({
        id: 'b-anon',
        name: 'Deleted borrower',
        contact: null,
        anonymized_at: '2026-05-07T00:00:00Z',
      }),
    ])
    renderPage()

    await waitFor(() => expect(screen.getByTestId('borrowers-list')).toBeInTheDocument())
    const row = screen.getByTestId('borrower-row-b-anon')
    expect(row).toHaveTextContent('borrowers.anonymized_label')
  })
})
