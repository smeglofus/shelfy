import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true })),
}))

vi.mock('../lib/api', () => ({
  listLoans: vi.fn(),
  createLoan: vi.fn(),
  returnLoan: vi.fn(),
  listBorrowers: vi.fn().mockResolvedValue([]),
  formatApiError: (e: unknown) => String(e),
}))

vi.mock('../lib/toast-store', () => ({
  useToastStore: (selector: (s: { showError: () => void; showSuccess: () => void }) => unknown) =>
    selector({ showError: vi.fn(), showSuccess: vi.fn() }),
}))

import { listLoans } from '../lib/api'
import type { Borrower, Loan } from '../lib/types'
import { LoanHistory } from './LoanHistory'

function makeBorrower(overrides: Partial<Borrower> = {}): Borrower {
  return {
    id: 'b-1',
    name: 'Alice Liddell',
    contact: 'alice@x.com',
    notes: null,
    anonymized_at: null,
    created_by_user_id: null,
    anonymized_by_user_id: null,
    merged_into_by_user_id: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'loan-1',
    book_id: 'book-1',
    borrower_id: null,
    borrower_name: 'Alice Liddell',
    borrower_contact: null,
    borrower: null,
    lent_date: '2026-05-01',
    due_date: null,
    returned_date: null,
    return_condition: null,
    notes: null,
    created_at: '2026-05-01T00:00:00Z',
    is_active: true,
    ...overrides,
  }
}

function renderHistory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <LoanHistory bookId="book-1" />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('LoanHistory borrower label', () => {
  it('prefers loan.borrower.name over the legacy borrower_name column', async () => {
    vi.mocked(listLoans).mockResolvedValue([
      makeLoan({
        id: 'l-renamed',
        borrower_id: 'b-renamed',
        borrower_name: 'Old Cached Name',
        borrower: makeBorrower({ id: 'b-renamed', name: 'Current Name' }),
      }),
    ])
    renderHistory()
    await waitFor(() => {
      expect(screen.getByTestId('loan-borrower-l-renamed')).toHaveTextContent('Current Name')
    })
  })

  it('renders the localized "Deleted borrower" label when the linked borrower is anonymized', async () => {
    vi.mocked(listLoans).mockResolvedValue([
      makeLoan({
        id: 'l-anon',
        borrower_id: 'b-anon',
        // The anonymization cascade writes the DB sentinel into this column.
        borrower_name: 'Deleted borrower',
        borrower: makeBorrower({
          id: 'b-anon',
          name: 'Deleted borrower',
          contact: null,
          anonymized_at: '2026-05-07T00:00:00Z',
        }),
      }),
    ])
    renderHistory()
    await waitFor(() => {
      expect(screen.getByTestId('loan-borrower-l-anon')).toHaveTextContent('borrowers.anonymized_label')
    })
  })

  it('falls back to loan.borrower_name when there is no nested borrower (legacy / typed-name lend)', async () => {
    vi.mocked(listLoans).mockResolvedValue([
      makeLoan({
        id: 'l-legacy',
        borrower_id: null,
        borrower_name: 'Some Random Person',
        borrower: null,
      }),
    ])
    renderHistory()
    await waitFor(() => {
      expect(screen.getByTestId('loan-borrower-l-legacy')).toHaveTextContent('Some Random Person')
    })
  })
})
