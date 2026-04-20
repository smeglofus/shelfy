/**
 * AuthContext tests — regression coverage for issue #125.
 *
 * The non-negotiables the reducer-based rewrite must hold:
 *   * ``isAuthenticated`` flips FALSE → TRUE exactly once on a login flow,
 *     never flapping through a half-applied "token but no user" state.
 *   * The TanStack Query cache is wiped on every auth boundary (login,
 *     logout) so a prior session's data can't bleed into the next render.
 *   * The bootstrap ``/auth/me`` fetch settles ``isLoading`` in a single
 *     reducer dispatch (no blank render from a transient null user).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Deferred-promise queue for /auth/me ─────────────────────────────────────
// Each call to ``getCurrentUser`` hands back a fresh deferred promise we can
// settle from a test. That matters because the same flow (bootstrap → login)
// calls ``/auth/me`` twice: the first call for bootstrap, the second for the
// new session. Reusing one resolver across both leads to spurious timeouts
// that look like real bugs but are just test infrastructure artefacts.

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
}

const meQueue: Deferred<{ id: string; email: string }>[] = []

function enqueueDeferred(): Deferred<{ id: string; email: string }> {
  let resolve!: (value: { id: string; email: string }) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<{ id: string; email: string }>((res, rej) => {
    resolve = res
    reject = rej
  })
  const deferred: Deferred<{ id: string; email: string }> = { promise, resolve, reject }
  meQueue.push(deferred)
  return deferred
}

function popNextMeCall(): Deferred<{ id: string; email: string }> {
  // Poll: the caller may have kicked off the login click before React's
  // microtask queue runs the actual ``getCurrentUser`` invocation.
  const next = meQueue.shift()
  if (!next) throw new Error('No pending getCurrentUser() call to resolve.')
  return next
}

vi.mock('../lib/api', () => {
  return {
    ACTIVE_LIBRARY_ID_KEY: 'shelfy.activeLibraryId',
    // Each call gets its own deferred so tests can settle them in order.
    getCurrentUser: vi.fn(() => enqueueDeferred().promise),
    login: vi.fn(() => Promise.resolve({ access_token: 'tok-live' })),
    register: vi.fn(() => Promise.resolve({ id: 'u1', email: 'a@b.co' })),
    logout: vi.fn(() => Promise.resolve()),
    googleOAuthCallback: vi.fn(() => Promise.resolve({ access_token: 'tok-google' })),
    registerAuthHandlers: vi.fn(),
  }
})

vi.mock('../lib/auth', () => ({
  setAccessToken: vi.fn(),
  clearTokens: vi.fn(),
}))

vi.mock('../lib/analytics', () => ({
  identifyUser: vi.fn(),
  resetUser: vi.fn(),
  trackEvent: vi.fn(),
}))

import * as apiModule from '../lib/api'
import { AuthProvider, useAuth } from './AuthContext'

// ── Harness ────────────────────────────────────────────────────────────────

interface SnapshotRow {
  isLoading: boolean
  isAuthenticated: boolean
  userId: string | null
}

function Probe({ onSnapshot }: { onSnapshot: (row: SnapshotRow) => void }) {
  const { isLoading, isAuthenticated, user, login, logout } = useAuth()
  onSnapshot({
    isLoading,
    isAuthenticated,
    userId: user?.id ?? null,
  })
  return (
    <div>
      <button data-testid='do-login' onClick={() => void login('a@b.co', 'pw')}>
        login
      </button>
      <button data-testid='do-logout' onClick={logout}>
        logout
      </button>
      <span data-testid='auth-flag'>{isAuthenticated ? 'yes' : 'no'}</span>
      <span data-testid='loading-flag'>{isLoading ? 'yes' : 'no'}</span>
    </div>
  )
}

async function waitForNextMeCall(): Promise<Deferred<{ id: string; email: string }>> {
  // Wait one microtask loop for the ``getCurrentUser`` mock to run and
  // enqueue its deferred. 200ms is an extremely generous ceiling in jsdom.
  for (let i = 0; i < 20 && meQueue.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 10))
  }
  return popNextMeCall()
}

function renderWithProviders(onSnapshot: (row: SnapshotRow) => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // Seed a query so we can prove the cache is wiped on auth transitions.
  queryClient.setQueryData(['stale-books'], [{ id: 'ghost' }])

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>{children}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  render(<Probe onSnapshot={onSnapshot} />, { wrapper })
  return queryClient
}

beforeEach(() => {
  meQueue.length = 0
  vi.mocked(apiModule.login).mockClear()
  vi.mocked(apiModule.logout).mockClear()
  vi.mocked(apiModule.getCurrentUser).mockClear()
})

afterEach(() => {
  cleanup()
  meQueue.length = 0
  vi.clearAllMocks()
})

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AuthContext — bootstrap', () => {
  it('starts in isLoading and flips to authenticated on successful /auth/me', async () => {
    const snapshots: SnapshotRow[] = []
    renderWithProviders((row) => snapshots.push(row))

    // First snapshot = bootstrap in flight, no user yet.
    expect(snapshots[0]).toMatchObject({ isLoading: true, isAuthenticated: false })

    const me = await waitForNextMeCall()
    await act(async () => {
      me.resolve({ id: 'u1', email: 'a@b.co' })
    })

    await waitFor(() =>
      expect(screen.getByTestId('loading-flag').textContent).toBe('no'),
    )
    expect(screen.getByTestId('auth-flag').textContent).toBe('yes')

    // Critical #125 invariant: we must NEVER observe a snapshot where
    // ``isAuthenticated`` is true but ``userId`` is null. The atomic
    // reducer dispatch should make that combination unrepresentable.
    for (const row of snapshots) {
      if (row.isAuthenticated) expect(row.userId).not.toBeNull()
    }
  })

  it('flips to unauthenticated + not-loading when bootstrap /auth/me rejects', async () => {
    renderWithProviders(() => {})

    const me = await waitForNextMeCall()
    await act(async () => {
      me.reject(new Error('401'))
    })

    await waitFor(() =>
      expect(screen.getByTestId('loading-flag').textContent).toBe('no'),
    )
    expect(screen.getByTestId('auth-flag').textContent).toBe('no')
  })
})

describe('AuthContext — login flow', () => {
  it('does NOT produce a half-applied auth snapshot during login', async () => {
    const snapshots: SnapshotRow[] = []
    renderWithProviders((row) => snapshots.push(row))

    // Settle bootstrap first (reject → unauthenticated).
    const bootstrapMe = await waitForNextMeCall()
    await act(async () => {
      bootstrapMe.reject(new Error('401'))
    })
    await waitFor(() =>
      expect(screen.getByTestId('auth-flag').textContent).toBe('no'),
    )

    snapshots.length = 0

    // Kick off login — this fires apiLogin then getCurrentUser under the hood.
    await act(async () => {
      screen.getByTestId('do-login').click()
    })

    const loginMe = await waitForNextMeCall()
    await act(async () => {
      loginMe.resolve({ id: 'u2', email: 'a@b.co' })
    })

    await waitFor(() =>
      expect(screen.getByTestId('auth-flag').textContent).toBe('yes'),
    )

    // The whole point of issue #125: we must never render with "token set,
    // user null" (the old split-state transition did exactly that). The
    // reducer pattern commits them together, so isAuthenticated only ever
    // flips once — never in a flapping two-step.
    for (const row of snapshots) {
      if (row.isAuthenticated) expect(row.userId).not.toBeNull()
    }
  })

  it('wipes the query cache when a session is established', async () => {
    const client = renderWithProviders(() => {})

    // Pre-seeded ghost data from a prior session still there at this point.
    expect(client.getQueryData(['stale-books'])).not.toBeUndefined()

    const bootstrapMe = await waitForNextMeCall()
    await act(async () => {
      bootstrapMe.reject(new Error('401'))
    })
    await waitFor(() =>
      expect(screen.getByTestId('auth-flag').textContent).toBe('no'),
    )

    await act(async () => {
      screen.getByTestId('do-login').click()
    })

    const loginMe = await waitForNextMeCall()
    await act(async () => {
      loginMe.resolve({ id: 'u2', email: 'a@b.co' })
    })

    await waitFor(() =>
      expect(screen.getByTestId('auth-flag').textContent).toBe('yes'),
    )

    // Session established — cache from the prior session must be gone, not
    // merely marked stale. A stale-but-present entry would produce the exact
    // "flash of wrong data" symptom described in #125.
    expect(client.getQueryData(['stale-books'])).toBeUndefined()
  })
})

describe('AuthContext — logout', () => {
  it('clears auth + wipes query cache on logout', async () => {
    const client = renderWithProviders(() => {})

    const bootstrapMe = await waitForNextMeCall()
    await act(async () => {
      bootstrapMe.resolve({ id: 'u1', email: 'a@b.co' })
    })
    await waitFor(() =>
      expect(screen.getByTestId('auth-flag').textContent).toBe('yes'),
    )

    // Re-seed so we can assert removal post-logout.
    client.setQueryData(['stale-books'], [{ id: 'ghost' }])

    await act(async () => {
      screen.getByTestId('do-logout').click()
    })

    await waitFor(() =>
      expect(screen.getByTestId('auth-flag').textContent).toBe('no'),
    )
    expect(client.getQueryData(['stale-books'])).toBeUndefined()
  })
})
