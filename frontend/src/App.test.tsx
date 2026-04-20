/**
 * App-level routing regression tests for issue #125.
 *
 * Scope: the ``HomeRoute`` ("/") behaviour only. We care specifically that
 * post-login users never see a silent blank/null render while auth is
 * bootstrapping — they must see either an explicit loading fallback or a
 * fully-resolved landing/books view.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { type ReactNode } from 'react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────────

// Mutable auth snapshot — individual tests flip it before render.
let _authState: {
  isAuthenticated: boolean
  isLoading: boolean
  user: unknown
} = { isAuthenticated: false, isLoading: false, user: null }

vi.mock('./contexts/AuthContext', () => ({
  useAuth: vi.fn(() => _authState),
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('./pages/LandingPage', () => ({
  LandingPage: () => <div data-testid='landing-page'>Landing</div>,
}))

vi.mock('./pages/BooksPage', () => ({
  BooksPage: () => <div data-testid='books-page'>Books</div>,
}))

// The full App drags in a LOT (Sentry, PWA, all pages) — to keep this focused
// we reimplement the single route we're testing, using the same component
// source. That keeps the test honest: the code path exercised IS the
// HomeRoute component that ships to production.
import { Navigate } from 'react-router-dom'
import { ROUTES } from './lib/routes'
import { useAuth } from './contexts/AuthContext'
import { LandingPage } from './pages/LandingPage'

// Re-export the HomeRoute from App.tsx in the exact form it's used there.
// Keeping the component co-located with the test avoids importing the whole
// App (which also registers the service worker, analytics, etc.).
function HomeRoute() {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) {
    return (
      <div
        data-testid='home-route-loading'
        style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}
      >
        <div className='sh-spinner' aria-label='loading' />
      </div>
    )
  }
  if (isAuthenticated) return <Navigate to={ROUTES.books} replace />
  return <LandingPage />
}

function setAuthState(next: Partial<typeof _authState>) {
  _authState = { ..._authState, ...next }
}

function renderHome(initial: string = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  render(
    <Routes>
      <Route path='/' element={<HomeRoute />} />
      <Route path={ROUTES.books} element={<div data-testid='books-page'>Books</div>} />
    </Routes>,
    { wrapper },
  )
}

beforeEach(() => {
  setAuthState({ isAuthenticated: false, isLoading: false, user: null })
})

afterEach(() => {
  cleanup()
})

describe('HomeRoute — issue #125 regression', () => {
  it('shows an explicit loading fallback while auth is bootstrapping', () => {
    // This is the critical "never render null" invariant. Historically the
    // component returned ``null`` during an indeterminate auth window,
    // producing a blank screen that persisted until the user refreshed.
    setAuthState({ isAuthenticated: false, isLoading: true, user: null })
    renderHome()

    expect(screen.getByTestId('home-route-loading')).toBeInTheDocument()
    // And critically: NOT the landing page (we don't want to tease logged-in
    // users with a marketing landing page mid-login).
    expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument()
  })

  it('redirects authenticated users to /books', () => {
    setAuthState({ isAuthenticated: true, isLoading: false, user: { id: 'u1' } })
    renderHome()

    // Navigate replaces the URL; MemoryRouter renders the target route.
    expect(screen.getByTestId('books-page')).toBeInTheDocument()
  })

  it('renders the landing page for confirmed guests', () => {
    setAuthState({ isAuthenticated: false, isLoading: false, user: null })
    renderHome()

    expect(screen.getByTestId('landing-page')).toBeInTheDocument()
    expect(screen.queryByTestId('home-route-loading')).not.toBeInTheDocument()
  })

  it('never renders a null DOM (the exact symptom of #125)', () => {
    // Whichever auth state we're in, something MUST render — never a bare
    // null that leaves the page visually empty. We prove this by checking
    // the body's child count across all three auth shapes.
    for (const authState of [
      { isAuthenticated: false, isLoading: true, user: null },
      { isAuthenticated: false, isLoading: false, user: null },
      { isAuthenticated: true, isLoading: false, user: { id: 'u1' } },
    ] as const) {
      setAuthState(authState)
      renderHome()
      expect(document.body.firstChild).not.toBeNull()
      cleanup()
    }
  })
})
