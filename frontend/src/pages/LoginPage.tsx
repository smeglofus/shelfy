import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../contexts/AuthContext'
import { formatApiError } from '../lib/api'

interface RouteState {
  from?: string
}

type AuthMode = 'signin' | 'register'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, register, isAuthenticated } = useAuth()

  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return (
    <section style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'var(--sh-bg)' }}>
      <div style={{ background: 'var(--sh-surface)', padding: '40px 32px', borderRadius: 'var(--sh-radius-xl)', width: '100%', maxWidth: 420, boxShadow: 'var(--sh-shadow-lg)', border: '1px solid var(--sh-border)' }}>
        <div style={{ display: 'flex', marginBottom: 24, border: '1px solid var(--sh-border)', borderRadius: 'var(--sh-radius-pill)', overflow: 'hidden' }}>
          <button type="button" onClick={() => setMode('signin')} style={{ flex: 1, border: 'none', padding: '10px 12px', background: mode === 'signin' ? 'var(--sh-teal-bg)' : 'transparent', color: 'var(--sh-text-main)', fontWeight: 600, cursor: 'pointer' }}>Sign in</button>
          <button type="button" onClick={() => setMode('register')} style={{ flex: 1, border: 'none', padding: '10px 12px', background: mode === 'register' ? 'var(--sh-teal-bg)' : 'transparent', color: 'var(--sh-text-main)', fontWeight: 600, cursor: 'pointer' }}>Register</button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)

            if (mode === 'register' && password !== confirmPassword) {
              setError('Passwords do not match.')
              return
            }

            setIsSubmitting(true)
            const authAction = mode === 'signin' ? login(email, password) : register(email, password)

            authAction
              .then(() => {
                const state = location.state as RouteState | undefined
                navigate(state?.from ?? '/', { replace: true })
              })
              .catch((authError: unknown) => {
                setError(formatApiError(authError))
              })
              .finally(() => setIsSubmitting(false))
          }}
          style={{ display: 'grid', gap: 16 }}
        >
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Email</span>
            <input className="sh-input" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span>Password</span>
            <input className="sh-input" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>

          {mode === 'register' && (
            <label style={{ display: 'grid', gap: 6 }}>
              <span>Confirm password</span>
              <input className="sh-input" required type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </label>
          )}

          {error && <p style={{ color: 'var(--sh-red)', margin: 0 }}>{error}</p>}

          <button type="submit" className="sh-btn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Register'}
          </button>
        </form>
      </div>
    </section>
  )
}
