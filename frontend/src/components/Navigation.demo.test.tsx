/**
 * Navigation — demo-aware sidebar (#288 follow-up).
 *
 * Inside `/demo/*` the same sidebar is reused so visitors can move between
 * search / bookshelf / add / scan / borrowers, but it must (a) keep every
 * destination inside the `/demo` subtree and (b) drop the truly
 * authenticated-only controls (settings, usage meter, logout). Borrowers IS
 * shown — the loan lifecycle is fully sandboxed client-side.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ logout: vi.fn() }) }))
// The wishlist nav item (#309) reads the libraries payload; never fetched in
// the demo (unauthenticated), but the hook still needs the module mocked.
vi.mock('../lib/api', () => ({ listLibraries: vi.fn(() => Promise.resolve([])) }))
// UsageMeterCard pulls plan usage from the API — never exercised in the demo,
// stubbed so the authenticated-mode assertions don't need a QueryClient.
vi.mock('./UsageMeterCard', () => ({ UsageMeterCard: () => null }))

import { Navigation } from './Navigation'

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

beforeEach(() => navigateMock.mockReset())
afterEach(() => cleanup())

describe('Navigation — demo mode', () => {
  it('exposes the demo-relevant items (incl. borrowers) and hides authenticated-only controls', () => {
    renderAt('/demo/books')

    expect(screen.getByText('nav.library')).toBeInTheDocument()
    expect(screen.getByText('nav.bookshelf')).toBeInTheDocument()
    expect(screen.getByText('nav.add')).toBeInTheDocument()
    expect(screen.getByText('nav.scan')).toBeInTheDocument()
    // Borrowers/loans are sandboxed client-side, so the entry IS shown.
    expect(screen.getByText('nav.borrowers')).toBeInTheDocument()

    expect(screen.queryByText('nav.settings')).not.toBeInTheDocument()
    expect(screen.queryByText('nav.logout')).not.toBeInTheDocument()
  })

  it('keeps navigation inside the /demo subtree', async () => {
    const user = userEvent.setup()
    renderAt('/demo/books')

    await user.click(screen.getByText('nav.add'))
    expect(navigateMock).toHaveBeenLastCalledWith('/demo/books/new')

    await user.click(screen.getByText('nav.scan'))
    expect(navigateMock).toHaveBeenLastCalledWith('/demo/scan')

    await user.click(screen.getByText('nav.bookshelf'))
    expect(navigateMock).toHaveBeenLastCalledWith('/demo/bookshelf')

    await user.click(screen.getByText('nav.borrowers'))
    expect(navigateMock).toHaveBeenLastCalledWith('/demo/borrowers')
  })

  it('keeps the full authenticated sidebar (borrowers/settings/logout) outside the demo', () => {
    renderAt('/books')

    expect(screen.getByText('nav.borrowers')).toBeInTheDocument()
    expect(screen.getByText('nav.settings')).toBeInTheDocument()
    expect(screen.getByText('nav.logout')).toBeInTheDocument()
  })

  it('navigates to production paths outside the demo', async () => {
    const user = userEvent.setup()
    renderAt('/books')

    await user.click(screen.getByText('nav.add'))
    expect(navigateMock).toHaveBeenLastCalledWith('/books/new')
  })
})
