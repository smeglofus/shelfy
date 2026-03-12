import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'

import { formatApiError, login } from '../lib/api'
import { persistTokens } from '../lib/auth'
import { useToastStore } from '../lib/toast-store'

interface RouteState {
  from?: string
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const showError = useToastStore((state) => state.showError)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (tokens) => {
      persistTokens(tokens.access_token)
      const state = location.state as RouteState | undefined
      navigate(state?.from ?? '/locations', { replace: true })
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })

  return (
    <section style={{ marginTop: '2rem', maxWidth: 360 }}>
      <h2>Login</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          loginMutation.mutate({ email, password })
        }}
        style={{ display: 'grid', gap: '0.75rem' }}
      >
        <label>
          Email
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          Password
          <input
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ width: '100%' }}
          />
        </label>
        <button type="submit" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </section>
  )
}
