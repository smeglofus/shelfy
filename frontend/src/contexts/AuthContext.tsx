import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  ACTIVE_LIBRARY_ID_KEY,
  getCurrentUser,
  googleOAuthCallback,
  login as apiLogin,
  refreshToken,
  register as apiRegister,
  registerAuthHandlers,
} from '../lib/api'
import { clearTokens, getRefreshToken, setAccessToken, setRefreshToken } from '../lib/auth'
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
  const [accessToken, setAccessTokenState] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const logout = useCallback(() => {
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
      applyAccessToken(tokens.access_token)
      setRefreshToken(tokens.refresh_token)
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
      setRefreshToken(tokens.refresh_token)
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
    const bootstrap = async () => {
      const existingRefreshToken = getRefreshToken()
      if (!existingRefreshToken) {
        setIsLoading(false)
        return
      }

      try {
        const refreshed = await refreshToken({ refresh_token: existingRefreshToken })
        applyAccessToken(refreshed.access_token)
        if ('refresh_token' in refreshed && refreshed.refresh_token) {
          setRefreshToken(refreshed.refresh_token)
        }
        await fetchUser()
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
