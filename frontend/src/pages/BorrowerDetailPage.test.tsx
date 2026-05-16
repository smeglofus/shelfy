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
  listBorrowers: vi.fn(),
  anonymizeBorrower: vi.fn(),
  updateBorrower: vi.fn(),
  mergeBorrowers: vi.fn(),
  formatApiError: (e: unknown) => String(e),
}))

vi.mock('../lib/toast-store', () => ({
  useToastStore: (selector: (s: { showError: () => void; showSuccess: () => void }) => unknown) =>
    selector({ showError: vi.fn(), showSuccess: vi.fn() }),
}))

import { anonymizeBorrower, getBorrower, listBorrowerLoans, listBorrowers, mergeBorrowers, updateBorrower } from '../lib/api'
import type { BorrowerDetail, BorrowerLoanItem } from '../lib/types'
import { BorrowerDetailPage } from './BorrowerDetailPage'

function makeBorrower(overrides: Partial<BorrowerDetail> = {}): BorrowerDetail {
  return {
    id: 'b-alice',
    name: 'Alice Liddell',
    contact: 'alice@x.com',
    notes: null,
    anonymized_at: null,
    created_by_user_id: null,
    anonymized_by_user_id: null,
    merged_into_by_user_id: null,
    // #261: detail-only resolved emails. Defaulted to null so legacy-row
    // tests don't need to set them; populate via ``overrides`` when testing
    // the audit footer.
    created_by_email: null,
    anonymized_by_email: null,
    merged_into_by_email: null,
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

  it('opens the merge modal, picks a target, confirms, and calls mergeBorrowers with the right direction', async () => {
    // Current page borrower is the SOURCE (gets deleted). Picker chooses the
    // TARGET (survives). After merge, navigate to the target.
    vi.mocked(getBorrower).mockResolvedValue(makeBorrower({ id: 'b-source', name: 'Alice (duplicate)' }))
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    vi.mocked(listBorrowers).mockResolvedValue({
      total: 1,
      page: 1,
      page_size: 100,
      items: [
        {
          id: 'b-target',
          name: 'Alice Liddell',
          contact: 'alice@x.com',
          notes: null,
          anonymized_at: null,
    created_by_user_id: null,
    anonymized_by_user_id: null,
    merged_into_by_user_id: null,
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-01T00:00:00Z',
          active_loans: 1,
          total_loans: 2,
          last_activity_at: null,
        },
      ],
    })
    vi.mocked(mergeBorrowers).mockResolvedValue(makeBorrower({ id: 'b-target', name: 'Alice Liddell' }))
    renderPage('b-source')

    const user = userEvent.setup()
    await user.click(await screen.findByTestId('merge-button'))

    // Pick the target from the candidate list.
    await user.click(await screen.findByTestId('merge-source-b-target'))

    // Confirm step shows the irreversible warning.
    expect(await screen.findByText('borrowers.merge_irreversible')).toBeInTheDocument()

    await user.click(screen.getByTestId('merge-confirm'))

    // mergeBorrowers(targetId, sourceId): current page is source, picked is target
    await waitFor(() =>
      expect(mergeBorrowers).toHaveBeenCalledWith('b-target', 'b-source'),
    )
  })

  it('merge picker excludes the current borrower and anonymized borrowers', async () => {
    vi.mocked(getBorrower).mockResolvedValue(makeBorrower({ id: 'b-current', name: 'Alice' }))
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    vi.mocked(listBorrowers).mockResolvedValue({
      total: 3,
      page: 1,
      page_size: 100,
      items: [
        // The current borrower — must be filtered out.
        {
          id: 'b-current',
          name: 'Alice',
          contact: null,
          notes: null,
          anonymized_at: null,
    created_by_user_id: null,
    anonymized_by_user_id: null,
    merged_into_by_user_id: null,
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-01T00:00:00Z',
          active_loans: 0,
          total_loans: 0,
          last_activity_at: null,
        },
        // Anonymized — must be filtered out.
        {
          id: 'b-anon',
          name: 'Deleted borrower',
          contact: null,
          notes: null,
          anonymized_at: '2026-05-07T00:00:00Z',
          created_by_user_id: null,
          anonymized_by_user_id: null,
          merged_into_by_user_id: null,
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-01T00:00:00Z',
          active_loans: 0,
          total_loans: 0,
          last_activity_at: null,
        },
        // Valid candidate.
        {
          id: 'b-other',
          name: 'Alice (other)',
          contact: null,
          notes: null,
          anonymized_at: null,
    created_by_user_id: null,
    anonymized_by_user_id: null,
    merged_into_by_user_id: null,
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-01T00:00:00Z',
          active_loans: 0,
          total_loans: 0,
          last_activity_at: null,
        },
      ],
    })
    renderPage('b-current')

    const user = userEvent.setup()
    await user.click(await screen.findByTestId('merge-button'))

    expect(await screen.findByTestId('merge-source-b-other')).toBeInTheDocument()
    expect(screen.queryByTestId('merge-source-b-current')).not.toBeInTheDocument()
    expect(screen.queryByTestId('merge-source-b-anon')).not.toBeInTheDocument()
  })

  it('shows a "showing X of Y" hint when more candidates exist than the picker can display', async () => {
    vi.mocked(getBorrower).mockResolvedValue(makeBorrower({ id: 'b-current', name: 'Current' }))
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    // Backend says total=150, but the page only returned 100 items (the
    // PICKER_PAGE_SIZE cap). The truncated hint should tell the user.
    vi.mocked(listBorrowers).mockResolvedValue({
      total: 150,
      page: 1,
      page_size: 100,
      items: Array.from({ length: 100 }, (_, i) => ({
        id: `b-${i}`,
        name: `Borrower ${i}`,
        contact: null,
        notes: null,
        anonymized_at: null,
    created_by_user_id: null,
    anonymized_by_user_id: null,
    merged_into_by_user_id: null,
        created_at: '2026-05-01T00:00:00Z',
        updated_at: '2026-05-01T00:00:00Z',
        active_loans: 0,
        total_loans: 0,
        last_activity_at: null,
      })),
    })
    renderPage('b-current')

    const user = userEvent.setup()
    await user.click(await screen.findByTestId('merge-button'))

    expect(await screen.findByTestId('merge-truncated-hint')).toBeInTheDocument()
  })

  it('does not show the merge button when the borrower is already anonymized', async () => {
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
    expect(screen.queryByTestId('merge-button')).not.toBeInTheDocument()
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

  // ── Audit footer (#261) ─────────────────────────────────────────────────
  //
  // The i18n test mock (src/test/setup.ts) returns bare keys and does NOT
  // run param interpolation, so these tests assert on testid presence
  // rather than the interpolated email/date strings. The interpolation
  // itself is exercised by the live i18next runtime in e2e.

  it('hides the audit footer entirely when every audit FK is null (legacy row)', async () => {
    vi.mocked(getBorrower).mockResolvedValue(makeBorrower())
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    renderPage()

    await screen.findByText('Alice Liddell')
    expect(screen.queryByTestId('borrower-audit-footer')).not.toBeInTheDocument()
  })

  it('renders the "created by …" line when the creator is set', async () => {
    vi.mocked(getBorrower).mockResolvedValue(
      makeBorrower({
        created_by_user_id: 'u-owner',
        created_by_email: 'owner@example.com',
      }),
    )
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    renderPage()

    expect(await screen.findByTestId('borrower-audit-footer')).toBeInTheDocument()
    expect(screen.getByTestId('audit-created-by')).toBeInTheDocument()
    // The other two lines stay hidden because their columns are NULL.
    expect(screen.queryByTestId('audit-anonymized-by')).not.toBeInTheDocument()
    expect(screen.queryByTestId('audit-merged-into-by')).not.toBeInTheDocument()
  })

  it('renders all three audit lines for a borrower with full audit history', async () => {
    vi.mocked(getBorrower).mockResolvedValue(
      makeBorrower({
        name: 'Deleted borrower',
        contact: null,
        notes: null,
        anonymized_at: '2026-05-07T00:00:00Z',
        created_by_user_id: 'u-owner',
        created_by_email: 'owner@example.com',
        anonymized_by_user_id: 'u-editor-b',
        anonymized_by_email: 'editor-b@example.com',
        merged_into_by_user_id: 'u-editor-a',
        merged_into_by_email: 'editor-a@example.com',
      }),
    )
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    renderPage()

    await screen.findByTestId('borrower-audit-footer')
    expect(screen.getByTestId('audit-created-by')).toBeInTheDocument()
    expect(screen.getByTestId('audit-anonymized-by')).toBeInTheDocument()
    expect(screen.getByTestId('audit-merged-into-by')).toBeInTheDocument()
  })

  it('still renders the line when the actor user_id is set but the email is null', async () => {
    // ondelete=SET NULL nulls both column and email in the normal case, but
    // if a partial state ever shipped (transient backend bug, schema drift),
    // the section must still render — the UI falls back to a localized
    // "unknown user" label via the audit_actor_unknown key.
    vi.mocked(getBorrower).mockResolvedValue(
      makeBorrower({
        created_by_user_id: 'u-vanished',
        created_by_email: null,
      }),
    )
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    renderPage()

    expect(await screen.findByTestId('audit-created-by')).toBeInTheDocument()
  })

  it('does not render the anonymized-by line when anonymized_at is unset (mid-state safety)', async () => {
    // The anonymized line is gated on BOTH the user_id AND the timestamp.
    // A row with user_id set but anonymized_at NULL should never happen
    // (services always stamp both together) — but if it does, the line stays
    // hidden so the user isn't shown "anonymized by X on —".
    vi.mocked(getBorrower).mockResolvedValue(
      makeBorrower({
        created_by_user_id: 'u-owner',
        created_by_email: 'owner@example.com',
        anonymized_by_user_id: 'u-editor',
        anonymized_by_email: 'editor@example.com',
        anonymized_at: null,
      }),
    )
    vi.mocked(listBorrowerLoans).mockResolvedValue([])
    renderPage()

    await screen.findByTestId('borrower-audit-footer')
    expect(screen.queryByTestId('audit-anonymized-by')).not.toBeInTheDocument()
  })
})
