/**
 * Demo-mode behaviour for BooksPage (#285).
 *
 * Renders the real page inside the DemoModeProvider with the real demo hooks
 * and in-memory store (no network). Asserts the page is fully usable for a
 * logged-out visitor and that network-only affordances are suppressed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Logged-out visitor — the demo must not depend on auth.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: false })),
}))

// Stub the API so the test fails loudly if the demo ever reaches the network.
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
  getOnboardingStatus: vi.fn(),
  completeOnboarding: vi.fn(),
  skipOnboarding: vi.fn(),
  resetOnboarding: vi.fn(),
  formatApiError: (e: unknown) => String(e),
}))

vi.mock('../lib/toast-store', () => ({
  useToastStore: vi.fn(
    (selector: (s: { showError: () => void; showSuccess: () => void; showInfo: () => void }) => unknown) =>
      selector({ showError: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn() }),
  ),
}))

import * as api from '../lib/api'
import { BooksPage } from './BooksPage'
import { DemoModeProvider } from '../features/demo/DemoContext'
import { seedDemoStore } from '../features/demo/seedDemoStore'

function renderDemo() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/demo/books']}>
        <DemoModeProvider>{children}</DemoModeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(<BooksPage />, { wrapper })
}

beforeEach(() => {
  sessionStorage.clear()
  seedDemoStore()
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  seedDemoStore()
})

describe('BooksPage — demo mode (#285)', () => {
  it('renders seeded books from the in-memory store without any network call', async () => {
    renderDemo()
    expect((await screen.findAllByText('Proměna')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Hobit').length).toBeGreaterThan(0)
    expect(api.listBooks).not.toHaveBeenCalled()
  })

  it('hides the sample-library banner even though demo books are samples', async () => {
    renderDemo()
    await screen.findAllByText('Proměna')
    expect(screen.queryByTestId('sample-library-banner')).not.toBeInTheDocument()
  })

  it('links book cards to the /demo book-detail twin (not the authenticated route)', async () => {
    renderDemo()
    await screen.findAllByText('Proměna')
    // Cards must point at the demo-prefixed detail route…
    const detailLinks = Array.from(document.querySelectorAll('a[href^="/demo/books/"]'))
      .filter((a) => a.getAttribute('href') !== '/demo/books/new')
    expect(detailLinks.length).toBeGreaterThan(0)
    // …and never at the authenticated `/books/:id` route (which would bounce to login).
    expect(document.querySelector('a[href^="/books/"]')).toBeNull()
  })
})
