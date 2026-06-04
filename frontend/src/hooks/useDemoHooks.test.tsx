import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Demo hooks must never touch the network. Mock the whole API module so any
// accidental call surfaces as an assertion failure instead of a real request.
vi.mock('../lib/api', () => ({
  listBooks: vi.fn(),
  listBooksForShelf: vi.fn(),
  getBook: vi.fn(),
  createBook: vi.fn(),
  updateBook: vi.fn(),
  deleteBook: vi.fn(),
  bulkDeleteBooks: vi.fn(),
  bulkMoveBooks: vi.fn(),
  bulkUpdateStatus: vi.fn(),
  clearSampleLibrary: vi.fn(),
  getJobStatus: vi.fn(),
  uploadBookImage: vi.fn(),
  listLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
  formatApiError: (e: unknown) => String(e),
}))

// The demo is for logged-out visitors: prove the hooks work with NO auth.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: false })),
}))

vi.mock('../lib/toast-store', () => ({
  useToastStore: vi.fn(
    (selector: (s: { showError: () => void; showSuccess: () => void; showInfo: () => void }) => unknown) =>
      selector({ showError: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn() }),
  ),
}))

import * as api from '../lib/api'
import { DemoModeProvider } from '../features/demo/DemoContext'
import { useDemoStore } from '../store/useDemoStore'
import {
  useBookCounts,
  useBooks,
  useBooksForShelf,
  useBulkUpdateStatus,
  useCreateBook,
} from './useBooks'
import { useLocations } from './useLocations'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <DemoModeProvider>{children}</DemoModeProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  sessionStorage.clear()
  useDemoStore.getState().reset()
  vi.clearAllMocks()
})

afterEach(() => {
  useDemoStore.getState().reset()
})

describe('demo-aware hooks (#285)', () => {
  it('useBooks reads the in-memory store without auth or network', async () => {
    const { result } = renderHook(() => useBooks({ pageSize: 10, page: 1 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.total).toBe(100)
    expect(result.current.data?.items).toHaveLength(10)
    expect(api.listBooks).not.toHaveBeenCalled()
  })

  it('useBooksForShelf returns the full ordered dataset from the store', async () => {
    const { result } = renderHook(() => useBooksForShelf(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(100)
    expect(api.listBooksForShelf).not.toHaveBeenCalled()
  })

  it('useLocations returns the seeded locations from the store', async () => {
    const { result } = renderHook(() => useLocations(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(3)
    expect(api.listLocations).not.toHaveBeenCalled()
  })

  it('useBookCounts mirrors the store reading-status tallies', async () => {
    const { result } = renderHook(() => useBookCounts(), { wrapper })
    await waitFor(() => expect(result.current.total).toBe(100))
    expect(result.current.read).toBe(42)
    expect(result.current.reading).toBe(11)
    expect(api.listBooks).not.toHaveBeenCalled()
  })

  it('useCreateBook appends to the in-memory store (no network)', async () => {
    const { result } = renderHook(() => useCreateBook(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ title: 'Demo addition', location_id: 'demo-loc-3' })
    })
    expect(useDemoStore.getState().counts().total).toBe(101)
    expect(api.createBook).not.toHaveBeenCalled()
  })

  it('useBulkUpdateStatus mutates the store and reports affected count', async () => {
    const { result } = renderHook(() => useBulkUpdateStatus(), { wrapper })
    await act(async () => {
      const res = await result.current.mutateAsync({ ids: ['demo-book-12'], reading_status: 'lent' })
      expect(res.affected).toBe(1)
    })
    expect(useDemoStore.getState().counts().lent).toBe(1)
    expect(api.bulkUpdateStatus).not.toHaveBeenCalled()
  })
})
