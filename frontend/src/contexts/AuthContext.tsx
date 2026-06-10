import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'

import {
  ACTIVE_LIBRARY_ID_KEY,
  bumpAuthEpoch,
  getCurrentUser,
  googleOAuthCallback,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  registerAuthHandlers,
} from '../lib/api'
import { clearTokens, setAccessToken } from '../lib/auth'
import { identifyUser, resetUser, trackEvent } from '../lib/analytics'
import type { User } from '../lib/types'

interface AuthContextValue {
  user: User | null
  accessToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  loginWithGoogle: (code: string, state: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// ── State machine ─────────────────────────────────────────────────────────
//
// Auth is modeled as a single state object so transitions commit atomically.
// Historically we kept `user`, `accessToken`, and `isLoading` in three separate
// ``useState`` hooks. The problem was that a successful ``login()`` updated
// them in sequence:
//
//   applyAccessToken(token)  // accessToken set; user still null
//   await fetchUser()        // user set some ticks later
//
// Between those two calls ``isAuthenticated = user && accessToken`` evaluated
// to ``false`` even though the session was valid server-side. Any render in
// that window (e.g. ``HomeRoute``) could misclassify the user as unauthenticated
// and show a blank screen — exactly the bug reported in #125.
//
// A reducer with a single ``setSession`` action commits user + token in one
// React state update, so no intermediate render ever sees a half-applied auth.
interface AuthState {
  user: User | null
  /**
   * Present-but-opaque marker used to gate ``isAuthenticated``. The real
   * credential lives in an HttpOnly cookie; this is strictly a "React-visible
   * am-I-logged-in" indicator, never a bearer token to send over the wire.
   */
  accessToken: string | null
  isLoading: boolean
}

type AuthAction =
  | { type: 'transition_started' }
  | { type: 'transition_finished' }
  | { type: 'bootstrap_settled'; user: User | null; accessToken: string | null }
  | { type: 'session_established'; user: User; accessToken: string }
  | { type: 'session_cleared' }
  | { type: 'token_refreshed'; accessToken: string }

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'transition_started':
      return { ...state, isLoading: true }
    case 'transition_finished':
      return { ...state, isLoading: false }
    case 'bootstrap_settled':
      // Race-safe bootstrap commit (#125): if a concurrent login / OAuth
      // callback has ALREADY established a session while bootstrap's own
      // /auth/me was in flight, do not clobber that session with whatever
      // bootstrap ultimately saw. This is the exact window that produced
      // the "blank UI after quick relogin" symptom — the OAuth callback's
      // ``session_established`` would commit, then bootstrap's late-arriving
      // ``bootstrap_settled(null, null)`` would wipe it back to logged-out.
      if (state.user && state.accessToken) {
        return { ...state, isLoading: false }
      }
      return { user: action.user, accessToken: action.accessToken, isLoading: false }
    case 'session_established':
      return { user: action.user, accessToken: action.accessToken, isLoading: false }
    case 'session_cleared':
      return { user: null, accessToken: null, isLoading: false }
    case 'token_refreshed':
      // Mid-flight rotate: keep existing user, swap in the fresh token.
      return { ...state, accessToken: action.accessToken }
    default:
      return state
  }
}

const INITIAL_STATE: AuthState = { user: null, accessToken: null, isLoading: true }

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [state, dispatch] = useReducer(authReducer, INITIAL_STATE)
  const transitionSequenceRef = useRef(0)
  const activeTransitionRef = useRef<number | null>(null)

  const beginTransition = useCallback(() => {
    const transitionId = ++transitionSequenceRef.current
    activeTransitionRef.current = transitionId
    dispatch({ type: 'transition_started' })
    return transitionId
  }, [])

  /**
   * Bootstrap begins its /auth/me probe on every mount, which — during an
   * OAuth callback — runs CONCURRENTLY with ``loginWithGoogle``. Because
   * React fires children's effects before the parent's, ``loginWithGoogle``
   * claims the transition ref first and bootstrap would otherwise stomp on
   * it, causing the login's own ``establishSession`` guard to mis-read the
   * override as "another transition took over" and bail without ever
   * dispatching ``session_established``. That was the repro in #125.
   *
   * So bootstrap YIELDS: it only claims the ref when no explicit transition
   * is already in flight. Its own dispatches also check they're still the
   * active transition before touching state.
   */
  const beginBootstrapTransition = useCallback(() => {
    const transitionId = ++transitionSequenceRef.current
    if (activeTransitionRef.current === null) {
      activeTransitionRef.current = transitionId
    }
    dispatch({ type: 'transition_started' })
    return transitionId
  }, [])

  const endTransition = useCallback((transitionId: number) => {
    if (activeTransitionRef.current !== transitionId) return
    activeTransitionRef.current = null
    dispatch({ type: 'transition_finished' })
  }, [])

  // ── Query-cache hygiene ────────────────────────────────────────────────
  // The query cache MUST be wiped on every auth boundary:
  //   * login: the cache may still hold shapes from a prior session (e.g. a
  //     previous user's /books list). Without this, a new user briefly sees
  //     stale "ghost data" after logging in — one of the visible symptoms
  //     behind issue #125.
  //   * logout: same hazard in reverse — the next visitor in a shared browser
  //     must not see the logged-out user's cached data.
  //
  // We call ``removeQueries`` rather than ``invalidateQueries`` — invalidation
  // only marks data stale, whereas removal guarantees the first render after
  // auth flip sees a fresh ``isLoading`` state, not a stale payload.
  const resetQueryCache = useCallback(() => {
    queryClient.removeQueries()
  }, [queryClient])

  const logout = useCallback(() => {
    const transitionId = beginTransition()
    // Invalidate anything in flight under the outgoing session so its
    // late-arriving 401 / refresh cannot reach back into the reducer (#125).
    bumpAuthEpoch()
    // Fire-and-forget; the server clears the auth cookies server-side.
    void apiLogout()
    clearTokens()
    try {
      localStorage.removeItem(ACTIVE_LIBRARY_ID_KEY)
      localStorage.removeItem('shelfy_onboarding_dismissed')
    } catch {
      // ignore storage failures
    }
    resetQueryCache()
    dispatch({ type: 'session_cleared' })
    resetUser()
    navigate('/login', { replace: true })
    endTransition(transitionId)
  }, [beginTransition, endTransition, navigate, resetQueryCache])

  /**
   * Establish a session atomically: one call to the backend for the user,
   * one single reducer dispatch. Callers hand us a fresh access-token marker
   * and we do the rest. ``isAuthenticated`` flips exactly once, so no consumer
   * ever sees the half-applied auth state that used to cause blank renders.
   */
  const establishSession = useCallback(
    async (accessTokenMarker: string, transitionId: number) => {
      // Keep the in-memory module singleton in sync so the axios interceptors
      // that live outside React can still read "has token" synchronously.
      setAccessToken(accessTokenMarker)
      // The backend response for apiLogin / googleOAuthCallback has already
      // installed the new session cookies. Bump the epoch a SECOND time
      // (login() bumps at transition start; this bumps at session-live) so
      // any /auth/me that was issued DURING the transition under the prior
      // epoch — e.g. the bootstrap effect's own pre-login probe — stale-
      // rejects on 401 instead of cascading into a refresh → onUnauthorized
      // → logout that would drop the session we just established (#125).
      bumpAuthEpoch()
      const user = await getCurrentUser()
      if (activeTransitionRef.current !== transitionId) return
      identifyUser(user.id)
      // Wipe any cached queries from a previous session before the UI can
      // remount under the new auth identity. Done BEFORE the dispatch so
      // downstream consumers rendering on the new state see a clean slate.
      resetQueryCache()
      dispatch({
        type: 'session_established',
        user,
        accessToken: accessTokenMarker,
      })
    },
    [resetQueryCache],
  )

  const login = useCallback(
    async (email: string, password: string) => {
      const transitionId = beginTransition()
      // Move to a new auth epoch BEFORE hitting the backend, so any stale
      // in-flight requests from the prior (logged-out) session are cleanly
      // dropped by the api.ts 401 interceptor (#125).
      bumpAuthEpoch()
      try {
        const tokens = await apiLogin({ email, password })
        await establishSession(tokens.access_token, transitionId)
      } catch (error) {
        dispatch({ type: 'session_cleared' })
        throw error
      } finally {
        endTransition(transitionId)
      }
    },
    [beginTransition, endTransition, establishSession],
  )

  const register = useCallback(
    async (email: string, password: string) => {
      await apiRegister({ email, password })
      trackEvent('signup')
      // Backend's /register does not issue cookies — log in immediately so
      // the next render is fully authenticated.
      await login(email, password)
    },
    [login],
  )

  const loginWithGoogle = useCallback(
    async (code: string, state: string) => {
      const transitionId = beginTransition()
      // Bump epoch before the POST /auth/google/callback, so bootstrap's
      // concurrent /auth/me (racing from the same remount — see #125) is
      // forced through the stale-epoch rejection path on its eventual 401
      // instead of tripping a refresh → onUnauthorized → logout cascade.
      bumpAuthEpoch()
      try {
        const tokens = await googleOAuthCallback({ code, state })
        await establishSession(tokens.access_token, transitionId)
      } catch (error) {
        dispatch({ type: 'session_cleared' })
        throw error
      } finally {
        endTransition(transitionId)
      }
    },
    [beginTransition, endTransition, establishSession],
  )

  const handleTokenRefresh = useCallback((token: string) => {
    if (activeTransitionRef.current !== null) return
    setAccessToken(token)
    dispatch({ type: 'token_refreshed', accessToken: token })
  }, [])

  const handleUnauthorized = useCallback(() => {
    if (activeTransitionRef.current !== null) return
    logout()
  }, [logout])

  useEffect(() => {
    registerAuthHandlers({
      onUnauthorized: handleUnauthorized,
      onTokenRefresh: handleTokenRefresh,
    })

    return () => registerAuthHandlers({ onUnauthorized: null, onTokenRefresh: null })
  }, [handleTokenRefresh, handleUnauthorized])

  useEffect(() => {
    // Bootstrap: if the HttpOnly cookie is still valid, /auth/me returns the
    // user. If not, surface the unauthenticated state. No token plumbing from
    // client-side storage is needed — everything flows through cookies.
    let cancelled = false
    const transitionId = beginBootstrapTransition()
    const bootstrap = async () => {
      try {
        const user = await getCurrentUser()
        if (cancelled) return
        // If an explicit transition (login / logout / OAuth) has taken over
        // while we were awaiting, defer to its outcome instead of racing to
        // dispatch. See beginBootstrapTransition's comment for #125 context.
        if (activeTransitionRef.current !== transitionId) return
        identifyUser(user.id)
        // Mark us authenticated with an opaque "session" sentinel — the real
        // token is in the HttpOnly cookie. Committed in the same reducer pass
        // as ``user`` so ``isAuthenticated`` can only flip true once.
        setAccessToken('session')
        dispatch({
          type: 'bootstrap_settled',
          user,
          accessToken: 'session',
        })
      } catch {
        if (cancelled) return
        if (activeTransitionRef.current !== transitionId) return
        clearTokens()
        dispatch({ type: 'bootstrap_settled', user: null, accessToken: null })
      } finally {
        endTransition(transitionId)
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [beginBootstrapTransition, endTransition])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: state.user,
      accessToken: state.accessToken,
      // Single source of truth — both fields are set / cleared in the same
      // reducer dispatch, so this can never be "true while user is null".
      isAuthenticated: Boolean(state.user && state.accessToken),
      isLoading: state.isLoading,
      login,
      register,
      loginWithGoogle,
      logout,
    }),
    [state, login, register, loginWithGoogle, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// The hook is deliberately co-located with its provider; a Fast Refresh
// full-reload on edits to this file is acceptable (auth re-bootstraps anyway).
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return context
}
