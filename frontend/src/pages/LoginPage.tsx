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
      navigate(state?.from ?? '/books', { replace: true }) // Defaulting to /books for better UX
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })

  return (
    <section style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'var(--sh-bg)' }}>
      <div style={{ background: 'var(--sh-surface)', padding: '40px 32px', borderRadius: 'var(--sh-radius-xl)', width: '100%', maxWidth: 400, boxShadow: 'var(--sh-shadow-lg)', border: '1px solid var(--sh-border)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h2 className="text-h1" style={{ marginBottom: 8 }}>Přihlášení</h2>
          <p className="text-p" style={{ color: 'var(--sh-text-muted)' }}>Vítejte zpět ve své knihovně</p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            loginMutation.mutate({ email, password })
          }}
          style={{ display: 'grid', gap: '20px' }}
        >
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--sh-text-main)', display: 'block', marginBottom: 8 }}>
              Email
            </label>
            <input
              className="sh-input"
              required
              type="email"
              value={email}
              placeholder="knihomol@email.cz"
              onChange={(event) => setEmail(event.target.value)}
              style={{ width: '100%', padding: '12px 16px' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--sh-text-main)', display: 'block', marginBottom: 8 }}>
              Heslo
            </label>
            <input
              className="sh-input"
              required
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={{ width: '100%', padding: '12px 16px' }}
            />
          </div>
          <button 
            type="submit" 
            className="sh-btn-primary hover-scale"
            disabled={loginMutation.isPending}
            style={{ marginTop: 12, padding: '14px', fontSize: 16 }}
          >
            {loginMutation.isPending ? 'Přihlašování…' : 'Přihlásit se'}
          </button>
        </form>
      </div>
    </section>
  )
}
