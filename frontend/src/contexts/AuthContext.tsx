import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'

import {
  ACTIVE_LIBRARY_ID_KEY,
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
  | { type: 'bootstrap_settled'; user: User | null; accessToken: string | null }
  | { type: 'session_established'; user: User; accessToken: string }
  | { type: 'session_cleared' }
  | { type: 'token_refreshed'; accessToken: string }

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'bootstrap_settled':
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
  }, [navigate, resetQueryCache])

  /**
   * Establish a session atomically: one call to the backend for the user,
   * one single reducer dispatch. Callers hand us a fresh access-token marker
   * and we do the rest. ``isAuthenticated`` flips exactly once, so no consumer
   * ever sees the half-applied auth state that used to cause blank renders.
   */
  const establishSession = useCallback(
    async (accessTokenMarker: string) => {
      // Keep the in-memory module singleton in sync so the axios interceptors
      // that live outside React can still read "has token" synchronously.
      setAccessToken(accessTokenMarker)
      const user = await getCurrentUser()
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
      const tokens = await apiLogin({ email, password })
      await establishSession(tokens.access_token)
    },
    [establishSession],
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
      const tokens = await googleOAuthCallback({ code, state })
      await establishSession(tokens.access_token)
    },
    [establishSession],
  )

  const handleTokenRefresh = useCallback((token: string) => {
    setAccessToken(token)
    dispatch({ type: 'token_refreshed', accessToken: token })
  }, [])

  useEffect(() => {
    registerAuthHandlers({
      onUnauthorized: logout,
      onTokenRefresh: handleTokenRefresh,
    })

    return () => registerAuthHandlers({ onUnauthorized: null, onTokenRefresh: null })
  }, [handleTokenRefresh, logout])

  useEffect(() => {
    // Bootstrap: if the HttpOnly cookie is still valid, /auth/me returns the
    // user. If not, surface the unauthenticated state. No token plumbing from
    // client-side storage is needed — everything flows through cookies.
    let cancelled = false
    const bootstrap = async () => {
      try {
        const user = await getCurrentUser()
        if (cancelled) return
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
        clearTokens()
        dispatch({ type: 'bootstrap_settled', user: null, accessToken: null })
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

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

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return context
}
