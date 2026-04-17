import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  // ``accessToken`` is kept in React state only as a cheap "am I authenticated?"
  // flag for downstream consumers. The real credential lives in an HttpOnly
  // cookie and is never visible to this JS.
  const [accessToken, setAccessTokenState] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

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
    setUser(null)
    setAccessTokenState(null)
    resetUser()
    navigate('/login', { replace: true })
  }, [navigate])

  const applyAccessToken = useCallback((token: string | null) => {
    setAccessToken(token)
    setAccessTokenState(token)
  }, [])

  const fetchUser = useCallback(async () => {
    const currentUser = await getCurrentUser()
    setUser(currentUser)
    identifyUser(currentUser.id)
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await apiLogin({ email, password })
      // Backend has already set the HttpOnly cookies; the access_token in
      // the body is only used as our in-memory "logged in" indicator.
      applyAccessToken(tokens.access_token)
      await fetchUser()
    },
    [applyAccessToken, fetchUser],
  )

  const register = useCallback(
    async (email: string, password: string) => {
      await apiRegister({ email, password })
      trackEvent('signup')
      await login(email, password)
    },
    [login],
  )

  const loginWithGoogle = useCallback(
    async (code: string, state: string) => {
      const tokens = await googleOAuthCallback({ code, state })
      applyAccessToken(tokens.access_token)
      await fetchUser()
    },
    [applyAccessToken, fetchUser],
  )

  useEffect(() => {
    registerAuthHandlers({
      onUnauthorized: logout,
      onTokenRefresh: (token) => applyAccessToken(token),
    })

    return () => registerAuthHandlers({ onUnauthorized: null, onTokenRefresh: null })
  }, [applyAccessToken, logout])

  useEffect(() => {
    // Bootstrap: if the HttpOnly cookie is still valid, /auth/me returns
    // the user. If not, we surface the unauthenticated state. No token
    // plumbing from client-side storage is needed anymore.
    const bootstrap = async () => {
      try {
        await fetchUser()
        // Success → we have a live session. Set a non-empty marker so
        // `isAuthenticated` flips without exposing the real token.
        applyAccessToken('session')
      } catch {
        clearTokens()
      } finally {
        setIsLoading(false)
      }
    }

    void bootstrap()
  }, [applyAccessToken, fetchUser])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accessToken,
      isAuthenticated: Boolean(user && accessToken),
      isLoading,
      login,
      register,
      loginWithGoogle,
      logout,
    }),
    [user, accessToken, isLoading, login, register, loginWithGoogle, logout],
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
