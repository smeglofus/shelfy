import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true })),
}))

vi.mock('../lib/api', () => ({
  createLoan: vi.fn(),
  listBorrowers: vi.fn(),
  formatApiError: (e: unknown) => String(e),
}))

vi.mock('../lib/toast-store', () => ({
  useToastStore: (selector: (s: { showError: () => void; showSuccess: () => void }) => unknown) =>
    selector({ showError: vi.fn(), showSuccess: vi.fn() }),
}))

import { createLoan, listBorrowers } from '../lib/api'
import type { BorrowerListItem, Loan } from '../lib/types'
import { LendBookModal } from './LendBookModal'

function makeBorrower(overrides: Partial<BorrowerListItem> = {}): BorrowerListItem {
  return {
    id: 'borrower-1',
    name: 'Alice Liddell',
    contact: 'alice@example.com',
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
    ...overrides,
  }
}

function mockBorrowersList(items: BorrowerListItem[]): void {
  vi.mocked(listBorrowers).mockResolvedValue({
    total: items.length,
    page: 1,
    page_size: 100,
    items,
  })
}

function makeLoan(): Loan {
  return {
    id: 'loan-1',
    book_id: 'book-1',
    borrower_id: null,
    borrower_name: 'Alice Liddell',
    borrower_contact: null,
    borrower: null,
    lent_date: '2026-05-07',
    due_date: null,
    returned_date: null,
    return_condition: null,
    notes: null,
    created_at: '2026-05-07T00:00:00Z',
    is_active: true,
  }
}

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <LendBookModal bookId="book-1" onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('LendBookModal', () => {
  it('lists existing borrowers as datalist options', async () => {
    mockBorrowersList([
      makeBorrower({ id: 'b1', name: 'Alice Liddell' }),
      makeBorrower({ id: 'b2', name: 'Bob Builder', contact: null }),
    ])
    renderModal()
    await waitFor(() => {
      const list = document.querySelector('[data-testid="borrower-suggestions"]') as HTMLDataListElement | null
      expect(list).not.toBeNull()
      expect(list!.querySelectorAll('option')).toHaveLength(2)
    })
    const list = document.querySelector('[data-testid="borrower-suggestions"]') as HTMLDataListElement
    const values = Array.from(list.querySelectorAll('option')).map((o) => o.getAttribute('value'))
    expect(values).toEqual(['Alice Liddell', 'Bob Builder'])
  })

  it('submits with borrower_id when typed name exactly matches an existing borrower', async () => {
    mockBorrowersList([
      makeBorrower({ id: 'borrower-42', name: 'Alice Liddell', contact: 'alice@x.com' }),
    ])
    vi.mocked(createLoan).mockResolvedValue(makeLoan())
    renderModal()
    await waitFor(() => expect(listBorrowers).toHaveBeenCalled())

    const user = userEvent.setup()
    const nameInput = screen.getByPlaceholderText('loans.borrower_name')
    await user.type(nameInput, 'Alice Liddell')

    // The "existing borrower" hint should appear, the contact field should
    // become read-only (won't be sent on submit either way).
    expect(await screen.findByTestId('borrower-existing-match')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'loans.lend_submit' }))

    await waitFor(() => expect(createLoan).toHaveBeenCalledTimes(1))
    const [, payload] = vi.mocked(createLoan).mock.calls[0]
    expect(payload).toMatchObject({
      borrower_id: 'borrower-42',
      lent_date: expect.any(String),
    })
    expect(payload).not.toHaveProperty('borrower_name')
    expect(payload).not.toHaveProperty('borrower_contact')
  })

  it('matches on a normalized name (trimmed, case-insensitive, collapsed whitespace)', async () => {
    mockBorrowersList([
      makeBorrower({ id: 'borrower-99', name: 'Alice Liddell' }),
    ])
    vi.mocked(createLoan).mockResolvedValue(makeLoan())
    renderModal()
    await waitFor(() => expect(listBorrowers).toHaveBeenCalled())

    const user = userEvent.setup()
    await user.type(
      screen.getByPlaceholderText('loans.borrower_name'),
      '  alice   liddell  ',
    )
    await user.click(screen.getByRole('button', { name: 'loans.lend_submit' }))

    await waitFor(() => expect(createLoan).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createLoan).mock.calls[0][1]).toMatchObject({
      borrower_id: 'borrower-99',
    })
  })

  it('falls back to legacy borrower_name + borrower_contact for a new borrower', async () => {
    mockBorrowersList([
      makeBorrower({ id: 'b1', name: 'Alice Liddell' }),
    ])
    vi.mocked(createLoan).mockResolvedValue(makeLoan())
    renderModal()
    await waitFor(() => expect(listBorrowers).toHaveBeenCalled())

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('loans.borrower_name'), 'Charlie Brown')
    await user.type(screen.getByPlaceholderText('loans.borrower_contact'), 'charlie@x.com')
    await user.click(screen.getByRole('button', { name: 'loans.lend_submit' }))

    await waitFor(() => expect(createLoan).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(createLoan).mock.calls[0][1]
    expect(payload).toMatchObject({
      borrower_name: 'Charlie Brown',
      borrower_contact: 'charlie@x.com',
    })
    expect(payload.borrower_id).toBeUndefined()
  })

  it('ambiguous name (two borrowers, same name) shows a disambiguation list, not the unambiguous-match hint', async () => {
    mockBorrowersList([
      makeBorrower({ id: 'b1', name: 'John Smith', contact: 'a@x.com' }),
      makeBorrower({ id: 'b2', name: 'John Smith', contact: 'b@x.com' }),
    ])
    renderModal()
    await waitFor(() => expect(listBorrowers).toHaveBeenCalled())

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('loans.borrower_name'), 'John Smith')

    // The single-match hint stays hidden until the user picks.
    expect(screen.queryByTestId('borrower-existing-match')).not.toBeInTheDocument()

    // The disambiguation panel lists every candidate (#250).
    const panel = await screen.findByTestId('borrower-disambiguation')
    expect(panel).toBeInTheDocument()
    expect(screen.getByTestId('borrower-disambiguation-b1')).toBeInTheDocument()
    expect(screen.getByTestId('borrower-disambiguation-b2')).toBeInTheDocument()
  })

  it('ambiguous name without an explicit pick still falls back to the legacy typed-name flow on submit', async () => {
    // The disambiguation panel is advisory — the user remains free to ignore
    // it and create a new borrower row (e.g. their typed Alice really is a
    // different person than either listed Alice). This preserves the
    // create-anyway escape hatch documented in the LendBookModal comments.
    mockBorrowersList([
      makeBorrower({ id: 'b1', name: 'John Smith', contact: 'a@x.com' }),
      makeBorrower({ id: 'b2', name: 'John Smith', contact: 'b@x.com' }),
    ])
    vi.mocked(createLoan).mockResolvedValue(makeLoan())
    renderModal()
    await waitFor(() => expect(listBorrowers).toHaveBeenCalled())

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('loans.borrower_name'), 'John Smith')
    expect(await screen.findByTestId('borrower-disambiguation')).toBeInTheDocument()

    // Submit without picking → typed-name flow.
    await user.click(screen.getByRole('button', { name: 'loans.lend_submit' }))

    await waitFor(() => expect(createLoan).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(createLoan).mock.calls[0][1]
    expect(payload).toMatchObject({ borrower_name: 'John Smith' })
    expect(payload.borrower_id).toBeUndefined()
  })

  it('clicking a disambiguation row pins the pick and submits with borrower_id', async () => {
    mockBorrowersList([
      makeBorrower({ id: 'b1', name: 'John Smith', contact: 'a@x.com' }),
      makeBorrower({ id: 'b2', name: 'John Smith', contact: 'b@x.com' }),
    ])
    vi.mocked(createLoan).mockResolvedValue(makeLoan())
    renderModal()
    await waitFor(() => expect(listBorrowers).toHaveBeenCalled())

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('loans.borrower_name'), 'John Smith')

    // Pick the second candidate.
    await user.click(await screen.findByTestId('borrower-disambiguation-b2'))

    // Disambiguation hides, single-match hint appears in its place.
    await waitFor(() => {
      expect(screen.queryByTestId('borrower-disambiguation')).not.toBeInTheDocument()
      expect(screen.getByTestId('borrower-existing-match')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'loans.lend_submit' }))

    await waitFor(() => expect(createLoan).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(createLoan).mock.calls[0][1]
    expect(payload).toMatchObject({ borrower_id: 'b2' })
    expect(payload).not.toHaveProperty('borrower_name')
  })

  it('retyping a different name after a pick clears the pick (disambiguation re-shows if still ambiguous)', async () => {
    mockBorrowersList([
      makeBorrower({ id: 'b1', name: 'John Smith', contact: 'a@x.com' }),
      makeBorrower({ id: 'b2', name: 'John Smith', contact: 'b@x.com' }),
      makeBorrower({ id: 'b3', name: 'Jane Doe', contact: null }),
    ])
    renderModal()
    await waitFor(() => expect(listBorrowers).toHaveBeenCalled())

    const user = userEvent.setup()
    const nameInput = screen.getByPlaceholderText('loans.borrower_name')

    await user.type(nameInput, 'John Smith')
    await user.click(await screen.findByTestId('borrower-disambiguation-b1'))
    expect(screen.getByTestId('borrower-existing-match')).toBeInTheDocument()

    // Switch to a different name — the pinned pick should drop.
    await user.clear(nameInput)
    await user.type(nameInput, 'Jane Doe')

    await waitFor(() => {
      // Jane is unique → unambiguous-match hint applies, but the cached pick
      // for the John id must not leak into the new selection.
      const existing = screen.queryByTestId('borrower-existing-match')
      expect(existing).toBeInTheDocument()
      expect(existing?.textContent ?? '').not.toContain('a@x.com')
    })
  })

  it('still works when there are no existing borrowers (preserves prior UX)', async () => {
    mockBorrowersList([])
    vi.mocked(createLoan).mockResolvedValue(makeLoan())
    renderModal()
    await waitFor(() => expect(listBorrowers).toHaveBeenCalled())

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('loans.borrower_name'), 'Eve First')
    await user.click(screen.getByRole('button', { name: 'loans.lend_submit' }))

    await waitFor(() => expect(createLoan).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(createLoan).mock.calls[0][1]
    expect(payload).toMatchObject({ borrower_name: 'Eve First' })
    expect(payload.borrower_id).toBeUndefined()
  })

  it('excludes anonymized borrowers from the picker', async () => {
    mockBorrowersList([
      makeBorrower({ id: 'b-alice', name: 'Alice', anonymized_at: null }),
      makeBorrower({
        id: 'b-deleted',
        name: 'Deleted borrower',
        contact: null,
        anonymized_at: '2026-05-07T00:00:00Z',
      }),
    ])
    renderModal()
    await waitFor(() => {
      const list = document.querySelector('[data-testid="borrower-suggestions"]') as HTMLDataListElement | null
      expect(list).not.toBeNull()
      expect(list!.querySelectorAll('option')).toHaveLength(1)
    })
    const list = document.querySelector('[data-testid="borrower-suggestions"]') as HTMLDataListElement
    const values = Array.from(list.querySelectorAll('option')).map((o) => o.getAttribute('value'))
    expect(values).toEqual(['Alice'])
  })

  it('shows an inline error when submit happens with an empty name', async () => {
    mockBorrowersList([])
    renderModal()
    await waitFor(() => expect(listBorrowers).toHaveBeenCalled())

    const user = userEvent.setup()
    // Bypass the native required validation by submitting via form's submit
    // button after clearing the field — userEvent will still trigger submit
    // because we click the button programmatically; the empty-required check
    // in our handler is what we want to exercise. Use form.requestSubmit() to
    // skip native validation.
    const form = screen.getByRole('button', { name: 'loans.lend_submit' }).closest('form') as HTMLFormElement
    form.noValidate = true
    await user.click(screen.getByRole('button', { name: 'loans.lend_submit' }))

    expect(await screen.findByText('loans.borrower_name_required')).toBeInTheDocument()
    expect(createLoan).not.toHaveBeenCalled()
  })
})
