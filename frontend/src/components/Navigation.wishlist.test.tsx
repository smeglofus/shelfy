/**
 * Navigation — wishlist nav item (#309).
 *
 * The item follows the active library's ``wishlist_enabled`` flag: shown
 * when on, gone when the owner turned the feature off, and never shown in
 * the demo (network-backed feature).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, logout: vi.fn() }),
}))
vi.mock('./UsageMeterCard', () => ({ UsageMeterCard: () => null }))
vi.mock('../lib/api', () => ({ listLibraries: vi.fn() }))
vi.mock('../store/useLibraryStore', () => ({
  useLibraryStore: vi.fn((selector: (s: { activeLibraryId: string | null }) => unknown) =>
    selector({ activeLibraryId: 'lib-1' })),
}))

import { listLibraries } from '../lib/api'
import type { Library } from '../lib/types'
import { Navigation } from './Navigation'

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return { id: 'lib-1', name: 'Test Library', role: 'owner', wishlist_enabled: true, ...overrides }
}

function renderAt(path: string): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Navigation />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Navigation — wishlist item (#309)', () => {
  it('shows the wishlist item when the active library has it enabled', async () => {
    vi.mocked(listLibraries).mockResolvedValue([makeLibrary()])
    renderAt('/books')

    await waitFor(() => {
      expect(screen.getAllByText('nav.wishlist').length).toBeGreaterThan(0)
    })
  })

  it('hides the wishlist item when the owner disabled it', async () => {
    vi.mocked(listLibraries).mockResolvedValue([makeLibrary({ wishlist_enabled: false })])
    renderAt('/books')

    // Wait for the libraries query to settle, then assert absence.
    await waitFor(() => {
      expect(listLibraries).toHaveBeenCalled()
    })
    expect(screen.queryByText('nav.wishlist')).not.toBeInTheDocument()
  })

  it('never shows the wishlist item in the demo', async () => {
    vi.mocked(listLibraries).mockResolvedValue([makeLibrary()])
    renderAt('/demo/books')

    expect(screen.queryByText('nav.wishlist')).not.toBeInTheDocument()
  })
})
