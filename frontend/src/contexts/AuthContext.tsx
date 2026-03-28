import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { getCurrentUser, login as apiLogin, refreshToken, register as apiRegister, registerAuthHandlers } from '../lib/api'
import { clearTokens, getRefreshToken, setAccessToken, setRefreshToken } from '../lib/auth'
import type { User } from '../lib/types'

interface AuthContextValue {
  user: User | null
  accessToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
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
    setUser(null)
    setAccessTokenState(null)
    navigate('/login', { replace: true })
  }, [navigate])

  const applyAccessToken = useCallback((token: string | null) => {
    setAccessToken(token)
    setAccessTokenState(token)
  }, [])

  const fetchUser = useCallback(async () => {
    const currentUser = await getCurrentUser()
    setUser(currentUser)
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
      // Backend currently may not implement registration in all environments.
      await apiRegister({ email, password })
      await login(email, password)
    },
    [login],
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
      logout,
    }),
    [user, accessToken, isLoading, login, register, logout],
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
