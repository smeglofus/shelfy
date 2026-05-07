import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true })),
}))

vi.mock('../lib/api', () => ({
  getBorrower: vi.fn(),
  listBorrowerLoans: vi.fn(),
  anonymizeBorrower: vi.fn(),
  updateBorrower: vi.fn(),
  formatApiError: (e: unknown) => String(e),
}))

vi.mock('../lib/toast-store', () => ({
  useToastStore: (selector: (s: { showError: () => void; showSuccess: () => void }) => unknown) =>
    selector({ showError: vi.fn(), showSuccess: vi.fn() }),
}))

import { anonymizeBorrower, getBorrower, listBorrowerLoans, updateBorrower } from '../lib/api'
import type { Borrower, BorrowerLoanItem } from '../lib/types'
import { BorrowerDetailPage } from './BorrowerDetailPage'

function makeBorrower(overrides: Partial<Borrower> = {}): Borrower {
  return {
    id: 'b-alice',
    name: 'Alice Liddell',
    contact: 'alice@x.com',
    notes: null,
    anonymized_at: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

function makeLoan(overrides: Partial<BorrowerLoanItem> = {}): BorrowerLoanItem {
  return {
    id: 'loan-1',
    book_id: 'book-1',
    book_title: 'Wonderland',
    book_author: 'Lewis Carroll',
    lent_date: '2026-05-01',
    due_date: null,
    returned_date: null,
    return_condition: null,
    notes: null,
    ...overrides,
  }
}

function renderPage(borrowerId = 'b-alice') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/borrowers/${borrowerId}`]}>
        <Routes>
          <Route path="/borrowers/:borrowerId" element={<BorrowerDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('BorrowerDetailPage', () => {
  it('renders the borrower header with name, contact and notes', async () => {
    vi.mocked(getBorrower).mockResolvedValue(makeBorrower({ notes: 'Regular borrower' }))
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    renderPage()

    expect(await screen.findByText('Alice Liddell')).toBeInTheDocument()
    expect(screen.getByText('alice@x.com')).toBeInTheDocument()
    expect(screen.getByText('Regular borrower')).toBeInTheDocument()
  })

  it('groups loans into active and returned sections', async () => {
    vi.mocked(getBorrower).mockResolvedValue(makeBorrower())
    vi.mocked(listBorrowerLoans).mockResolvedValue([
      makeLoan({ id: 'l-active-1', book_id: 'book-a', book_title: 'Active Book', returned_date: null }),
      makeLoan({
        id: 'l-returned-1',
        book_id: 'book-b',
        book_title: 'Returned Book',
        returned_date: '2026-04-20',
        return_condition: 'good',
      }),
    ])
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('borrower-active-list')).toBeInTheDocument()
      expect(screen.getByTestId('borrower-returned-list')).toBeInTheDocument()
    })

    const activeRow = screen.getByTestId('borrower-loan-l-active-1')
    expect(activeRow).toHaveTextContent('Active Book')

    const returnedRow = screen.getByTestId('borrower-loan-l-returned-1')
    expect(returnedRow).toHaveTextContent('Returned Book')
    expect(screen.getByTestId('borrower-loan-condition-l-returned-1')).toBeInTheDocument()
  })

  it('shows the empty state for active loans when none exist', async () => {
    vi.mocked(getBorrower).mockResolvedValue(makeBorrower())
    vi.mocked(listBorrowerLoans).mockResolvedValue([
      makeLoan({ id: 'l-returned-only', returned_date: '2026-04-01' }),
    ])
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('borrower-active-empty')).toBeInTheDocument()
      expect(screen.getByTestId('borrower-returned-list')).toBeInTheDocument()
    })
  })

  it('shows the empty state for returned loans when none exist', async () => {
    vi.mocked(getBorrower).mockResolvedValue(makeBorrower())
    vi.mocked(listBorrowerLoans).mockResolvedValue([
      makeLoan({ id: 'l-active-only', returned_date: null }),
    ])
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('borrower-returned-empty')).toBeInTheDocument()
      expect(screen.getByTestId('borrower-active-list')).toBeInTheDocument()
    })
  })

  it('shows both empty states for a brand-new borrower with no loans', async () => {
    vi.mocked(getBorrower).mockResolvedValue(makeBorrower())
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('borrower-active-empty')).toBeInTheDocument()
      expect(screen.getByTestId('borrower-returned-empty')).toBeInTheDocument()
    })
  })

  it('shows the not-found state when the borrower request errors', async () => {
    vi.mocked(getBorrower).mockRejectedValue(new Error('404'))
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    renderPage()

    expect(await screen.findByTestId('borrower-detail-error')).toBeInTheDocument()
  })

  it('shows the localized "Deleted borrower" label and a hint when anonymized', async () => {
    vi.mocked(getBorrower).mockResolvedValue(
      makeBorrower({
        name: 'Deleted borrower',
        contact: null,
        notes: null,
        anonymized_at: '2026-05-07T00:00:00Z',
      }),
    )
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    renderPage()

    expect(await screen.findByText('borrowers.anonymized_label')).toBeInTheDocument()
    expect(screen.getByTestId('borrower-anonymized-badge')).toBeInTheDocument()
    expect(screen.queryByTestId('anonymize-button')).not.toBeInTheDocument()
  })

  it('shows the Anonymize button only when the borrower is not yet anonymized', async () => {
    vi.mocked(getBorrower).mockResolvedValue(makeBorrower())
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    renderPage()

    expect(await screen.findByTestId('anonymize-button')).toBeInTheDocument()
  })

  it('opens the confirmation modal and calls the anonymize API on confirm', async () => {
    vi.mocked(getBorrower).mockResolvedValue(makeBorrower())
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    vi.mocked(anonymizeBorrower).mockResolvedValue(
      makeBorrower({
        name: 'Deleted borrower',
        contact: null,
        notes: null,
        anonymized_at: '2026-05-07T00:00:00Z',
      }),
    )
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByTestId('anonymize-button'))

    // Confirmation modal includes the irreversible warning
    expect(await screen.findByText('borrowers.anonymize_irreversible')).toBeInTheDocument()

    await user.click(screen.getByTestId('anonymize-confirm'))

    await waitFor(() => expect(anonymizeBorrower).toHaveBeenCalledWith('b-alice'))
  })

  it('opens the edit modal and PATCHes via updateBorrower on save', async () => {
    vi.mocked(getBorrower).mockResolvedValue(makeBorrower())
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    vi.mocked(updateBorrower).mockResolvedValue(
      makeBorrower({ name: 'Alice (Renamed)', contact: 'new@x.com' }),
    )
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByTestId('edit-button'))

    // The history-doesn't-propagate hint is shown.
    expect(await screen.findByTestId('edit-borrower-history-hint')).toBeInTheDocument()

    const nameInput = screen.getByTestId('edit-borrower-name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Alice (Renamed)')

    const contactInput = screen.getByTestId('edit-borrower-contact')
    await user.clear(contactInput)
    await user.type(contactInput, 'new@x.com')

    await user.click(screen.getByTestId('edit-borrower-save'))

    await waitFor(() => {
      expect(updateBorrower).toHaveBeenCalledWith('b-alice', {
        name: 'Alice (Renamed)',
        contact: 'new@x.com',
        notes: null,
      })
    })
  })

  it('does not show the edit button when the borrower is already anonymized', async () => {
    vi.mocked(getBorrower).mockResolvedValue(
      makeBorrower({
        name: 'Deleted borrower',
        contact: null,
        notes: null,
        anonymized_at: '2026-05-07T00:00:00Z',
      }),
    )
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    renderPage()

    expect(await screen.findByText('borrowers.anonymized_label')).toBeInTheDocument()
    expect(screen.queryByTestId('edit-button')).not.toBeInTheDocument()
  })

  it('cancel button closes the confirmation modal without calling the API', async () => {
    vi.mocked(getBorrower).mockResolvedValue(makeBorrower())
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByTestId('anonymize-button'))
    expect(await screen.findByText('borrowers.anonymize_irreversible')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.cancel' }))

    await waitFor(() => {
      expect(screen.queryByText('borrowers.anonymize_irreversible')).not.toBeInTheDocument()
    })
    expect(anonymizeBorrower).not.toHaveBeenCalled()
  })
})
