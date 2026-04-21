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
import { useEffect, type ReactNode } from 'react'
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
let authHandlers: {
  onUnauthorized: (() => void) | null
  onTokenRefresh: ((accessToken: string) => void) | null
} = { onUnauthorized: null, onTokenRefresh: null }

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
    registerAuthHandlers: vi.fn((handlers: {
      onUnauthorized: (() => void) | null
      onTokenRefresh: ((accessToken: string) => void) | null
    }) => {
      authHandlers = handlers
    }),
    // bumpAuthEpoch is a no-op at the AuthContext unit level — the real epoch
    // plumbing is covered by api.ts tests. The mock just has to exist so the
    // import doesn't break.
    bumpAuthEpoch: vi.fn(() => 1),
    getAuthEpoch: vi.fn(() => 1),
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
  authHandlers = { onUnauthorized: null, onTokenRefresh: null }
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

  it('ignores stale unauthorized callbacks while login transition is in flight', async () => {
    renderWithProviders(() => {})

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

    // Simulate race from stale in-flight request:
    // /auth/me -> 401, refresh -> 401, interceptor calls onUnauthorized.
    await act(async () => {
      authHandlers.onUnauthorized?.()
      authHandlers.onUnauthorized?.()
    })

    const loginMe = await waitForNextMeCall()
    await act(async () => {
      loginMe.resolve({ id: 'u2', email: 'u2@example.com' })
    })

    await waitFor(() =>
      expect(screen.getByTestId('auth-flag').textContent).toBe('yes'),
    )
    expect(vi.mocked(apiModule.logout)).not.toHaveBeenCalled()
  })
})

// Mounts as a child of AuthProvider so its useEffect fires BEFORE the parent's
// bootstrap effect (React fires effects bottom-up). This reproduces the exact
// mount shape of OAuthCallbackPage, which is what originally triggered the
// concurrent bootstrap-vs-OAuth race in #125.
function AutoOAuthLogin() {
  const { loginWithGoogle } = useAuth()
  useEffect(() => {
    void loginWithGoogle('auth-code', 'state-token')
  }, [loginWithGoogle])
  return null
}

function renderWithOAuthCallback(onSnapshot: (row: SnapshotRow) => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>
          <AutoOAuthLogin />
          {children}
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  render(<Probe onSnapshot={onSnapshot} />, { wrapper })
  return queryClient
}

describe('AuthContext — concurrent bootstrap race (#125)', () => {
  it('completes OAuth login even when bootstrap /auth/me is in flight', async () => {
    // Reproduces the original #125 repro: an OAuth callback remount fires
    // loginWithGoogle (child useEffect) BEFORE AuthProvider's bootstrap
    // useEffect runs. Before the fix, bootstrap's beginTransition would
    // overwrite loginWithGoogle's activeTransitionRef, making
    // establishSession's guard (``activeTransitionRef.current !== transitionId``)
    // false and causing it to bail silently — no session_established was
    // ever dispatched and the UI sat in isLoading=false, isAuthenticated=false.
    //
    // With the fix, beginBootstrapTransition YIELDS when a transition is
    // already active, so establishSession's guard passes and the session
    // commits atomically.
    const snapshots: SnapshotRow[] = []
    renderWithOAuthCallback((row) => snapshots.push(row))

    // Effect order + microtask scheduling produces this queue:
    //   #1 = bootstrap's /auth/me (parent effect, no awaits before the call)
    //   #2 = establishSession's /auth/me (after googleOAuthCallback resolves)
    const bootstrapMe = await waitForNextMeCall()
    const oauthMe = await waitForNextMeCall()

    // Reject bootstrap first — the realistic case: the HttpOnly cookie from
    // the previous session is gone, so /auth/me returns 401. Under the old
    // code this would dispatch bootstrap_settled(null, null) and ALSO cause
    // the OAuth callback's guard to bail. Now it's a no-op.
    await act(async () => {
      bootstrapMe.reject(new Error('401 stale cookie'))
    })

    // OAuth side completes — must dispatch session_established.
    await act(async () => {
      oauthMe.resolve({ id: 'u-oauth', email: 'oauth@example.com' })
    })

    await waitFor(() =>
      expect(screen.getByTestId('auth-flag').textContent).toBe('yes'),
    )
    expect(screen.getByTestId('loading-flag').textContent).toBe('no')

    // The atomic-dispatch invariant from #125 must hold under race conditions
    // too: no snapshot may have isAuthenticated=true with userId=null.
    for (const row of snapshots) {
      if (row.isAuthenticated) expect(row.userId).not.toBeNull()
    }

    // And the stale bootstrap rejection MUST NOT have cascaded into logout.
    expect(vi.mocked(apiModule.logout)).not.toHaveBeenCalled()
  })

  it('late bootstrap rejection does not clobber an established OAuth session', async () => {
    // Same remount shape, different settlement order: OAuth completes FIRST,
    // then bootstrap's /auth/me rejects late. The non-destructive
    // ``bootstrap_settled`` reducer rule (reducer checks "user+token already
    // set? just end loading") is the final line of defense here, beneath the
    // active-transition ref guard. Either guard alone would catch this; having
    // both makes the fix robust to future refactors of the transition plumbing.
    renderWithOAuthCallback(() => {})

    const bootstrapMe = await waitForNextMeCall()
    const oauthMe = await waitForNextMeCall()

    await act(async () => {
      oauthMe.resolve({ id: 'u-oauth', email: 'oauth@example.com' })
    })
    await waitFor(() =>
      expect(screen.getByTestId('auth-flag').textContent).toBe('yes'),
    )

    // Late 401 on the pre-OAuth /auth/me — used to clobber the session.
    await act(async () => {
      bootstrapMe.reject(new Error('401 stale cookie'))
    })

    // Session is still alive; no involuntary logout.
    expect(screen.getByTestId('auth-flag').textContent).toBe('yes')
    expect(screen.getByTestId('loading-flag').textContent).toBe('no')
    expect(vi.mocked(apiModule.logout)).not.toHaveBeenCalled()
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

  it('supports quick logout -> login without ending in an unauthenticated state', async () => {
    renderWithProviders(() => {})

    const bootstrapMe = await waitForNextMeCall()
    await act(async () => {
      bootstrapMe.resolve({ id: 'u1', email: 'a@b.co' })
    })
    await waitFor(() =>
      expect(screen.getByTestId('auth-flag').textContent).toBe('yes'),
    )

    await act(async () => {
      screen.getByTestId('do-logout').click()
    })
    await waitFor(() =>
      expect(screen.getByTestId('auth-flag').textContent).toBe('no'),
    )

    await act(async () => {
      screen.getByTestId('do-login').click()
    })

    // A late stale unauthorized signal should be ignored during this transition.
    await act(async () => {
      authHandlers.onUnauthorized?.()
    })

    const loginMe = await waitForNextMeCall()
    await act(async () => {
      loginMe.resolve({ id: 'u3', email: 'u3@example.com' })
    })

    await waitFor(() =>
      expect(screen.getByTestId('auth-flag').textContent).toBe('yes'),
    )
    expect(screen.getByTestId('loading-flag').textContent).toBe('no')
  })
})
