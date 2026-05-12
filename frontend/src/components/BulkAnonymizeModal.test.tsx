import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api', () => ({
  bulkAnonymizeBorrowersByDate: vi.fn(),
  formatApiError: (e: unknown) => String(e),
}))

vi.mock('../lib/toast-store', () => ({
  useToastStore: (selector: (s: { showError: () => void; showSuccess: () => void }) => unknown) =>
    selector({ showError: vi.fn(), showSuccess: vi.fn() }),
}))

import { bulkAnonymizeBorrowersByDate } from '../lib/api'
import { BulkAnonymizeModal } from './BulkAnonymizeModal'

function renderModal(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <BulkAnonymizeModal onClose={onClose} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('BulkAnonymizeModal', () => {
  it('rejects an empty cutoff date with an inline error', async () => {
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('bulk-anon-preview'))
    expect(screen.getByText('borrowers.bulk_anon_cutoff_required')).toBeInTheDocument()
    expect(bulkAnonymizeBorrowersByDate).not.toHaveBeenCalled()
  })

  it('preview step calls the endpoint with dry_run=true and reveals the count', async () => {
    vi.mocked(bulkAnonymizeBorrowersByDate).mockResolvedValueOnce({ affected: 7 })

    renderModal()
    const user = userEvent.setup()
    await user.type(screen.getByTestId('bulk-anon-cutoff'), '2025-01-01')
    await user.click(screen.getByTestId('bulk-anon-preview'))

    await waitFor(() => {
      expect(bulkAnonymizeBorrowersByDate).toHaveBeenCalledWith({
        inactive_since: '2025-01-01',
        dry_run: true,
      })
    })
    expect(await screen.findByTestId('bulk-anon-summary')).toBeInTheDocument()
    expect(screen.getByTestId('bulk-anon-confirm')).toBeInTheDocument()
  })

  it('confirm step calls the endpoint with dry_run=false and closes the modal on success', async () => {
    vi.mocked(bulkAnonymizeBorrowersByDate)
      .mockResolvedValueOnce({ affected: 3 })  // dry-run
      .mockResolvedValueOnce({ affected: 3 })  // real run

    const onClose = vi.fn()
    renderModal(onClose)

    const user = userEvent.setup()
    await user.type(screen.getByTestId('bulk-anon-cutoff'), '2025-06-01')
    await user.click(screen.getByTestId('bulk-anon-preview'))

    await screen.findByTestId('bulk-anon-summary')
    await user.click(screen.getByTestId('bulk-anon-confirm'))

    await waitFor(() => {
      const calls = vi.mocked(bulkAnonymizeBorrowersByDate).mock.calls
      const lastCall = calls[calls.length - 1]
      expect(lastCall?.[0]).toEqual({ inactive_since: '2025-06-01', dry_run: false })
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('disables the confirm button when preview returns zero (nothing to do)', async () => {
    vi.mocked(bulkAnonymizeBorrowersByDate).mockResolvedValueOnce({ affected: 0 })

    renderModal()
    const user = userEvent.setup()
    await user.type(screen.getByTestId('bulk-anon-cutoff'), '2025-01-01')
    await user.click(screen.getByTestId('bulk-anon-preview'))

    const confirm = await screen.findByTestId('bulk-anon-confirm')
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveTextContent('borrowers.bulk_anon_nothing_to_do')
  })
})
