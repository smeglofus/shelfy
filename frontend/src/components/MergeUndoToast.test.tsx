import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true })),
}))

vi.mock('../lib/api', () => ({
  undoMerge: vi.fn(),
  formatApiError: (e: unknown) => String(e),
}))

vi.mock('../lib/toast-store', () => ({
  useToastStore: (selector: (s: { showError: () => void; showSuccess: () => void }) => unknown) =>
    selector({ showError: vi.fn(), showSuccess: vi.fn() }),
}))

import { undoMerge } from '../lib/api'
import { useMergeUndoStore } from '../lib/merge-undo-store'
import { MergeUndoToast } from './MergeUndoToast'

function renderToast() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MergeUndoToast />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useMergeUndoStore.setState({ pending: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MergeUndoToast', () => {
  it('renders nothing when no merge is pending', () => {
    renderToast()
    expect(screen.queryByTestId('merge-undo-toast')).not.toBeInTheDocument()
  })

  it('renders the toast with countdown when a merge has just happened', () => {
    useMergeUndoStore.setState({
      pending: {
        token: 'tok-abc',
        undoUntil: new Date(Date.now() + 8_000).toISOString(),
        sourceName: 'Alice (dup)',
        targetName: 'Alice Liddell',
      },
    })
    renderToast()
    expect(screen.getByTestId('merge-undo-toast')).toBeInTheDocument()
    expect(screen.getByTestId('merge-undo-button')).toBeInTheDocument()
    expect(screen.getByTestId('merge-undo-dismiss')).toBeInTheDocument()
  })

  it('calls undoMerge with the stored token when the button is clicked', async () => {
    useMergeUndoStore.setState({
      pending: {
        token: 'tok-xyz',
        undoUntil: new Date(Date.now() + 8_000).toISOString(),
        sourceName: 'A',
        targetName: 'B',
      },
    })
    vi.mocked(undoMerge).mockResolvedValue({
      id: 'restored',
      name: 'A',
      contact: null,
      notes: null,
      anonymized_at: null,
      pending_anonymization_until: null,
      created_by_user_id: null,
      anonymized_by_user_id: null,
      merged_into_by_user_id: null,
      created_at: '2026-05-19T00:00:00Z',
      updated_at: '2026-05-19T00:00:00Z',
    })
    renderToast()

    const user = userEvent.setup()
    await user.click(screen.getByTestId('merge-undo-button'))

    await waitFor(() => expect(undoMerge).toHaveBeenCalledWith('tok-xyz'))
  })

  it('dismiss button clears the pending entry without calling the API', async () => {
    useMergeUndoStore.setState({
      pending: {
        token: 'tok-1',
        undoUntil: new Date(Date.now() + 8_000).toISOString(),
        sourceName: 'A',
        targetName: 'B',
      },
    })
    renderToast()

    const user = userEvent.setup()
    await user.click(screen.getByTestId('merge-undo-dismiss'))

    await waitFor(() => {
      expect(useMergeUndoStore.getState().pending).toBeNull()
      expect(screen.queryByTestId('merge-undo-toast')).not.toBeInTheDocument()
    })
    expect(undoMerge).not.toHaveBeenCalled()
  })

  it('auto-clears when the window has already expired', () => {
    useMergeUndoStore.setState({
      pending: {
        token: 'tok-expired',
        undoUntil: new Date(Date.now() - 1_000).toISOString(),
        sourceName: 'A',
        targetName: 'B',
      },
    })
    renderToast()
    // Effect runs synchronously after the initial render; expired entries
    // are cleared before any UI is shown.
    expect(screen.queryByTestId('merge-undo-toast')).not.toBeInTheDocument()
  })
})
