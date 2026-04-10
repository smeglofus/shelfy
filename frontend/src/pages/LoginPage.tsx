import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../contexts/AuthContext'
import { formatApiError, getGoogleAuthorizeUrl } from '../lib/api'
import { trackEvent } from '../lib/analytics'

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
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  const handleGoogleLogin = () => {
    setError(null)
    setIsGoogleLoading(true)
    trackEvent('oauth_google_start')
    getGoogleAuthorizeUrl()
      .then((data) => {
        window.location.href = data.auth_url
      })
      .catch((err: unknown) => {
        setError(formatApiError(err))
        setIsGoogleLoading(false)
      })
  }

  return (
    <section style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'var(--sh-bg)' }}>
      <div style={{ background: 'var(--sh-surface)', padding: '40px 32px', borderRadius: 'var(--sh-radius-xl)', width: '100%', maxWidth: 420, boxShadow: 'var(--sh-shadow-lg)', border: '1px solid var(--sh-border)' }}>
        <div style={{ display: 'flex', marginBottom: 24, border: '1px solid var(--sh-border)', borderRadius: 'var(--sh-radius-pill)', overflow: 'hidden' }}>
          <button type="button" onClick={() => setMode('signin')} style={{ flex: 1, border: 'none', padding: '10px 12px', background: mode === 'signin' ? 'var(--sh-teal-bg)' : 'transparent', color: 'var(--sh-text-main)', fontWeight: 600, cursor: 'pointer' }}>Sign in</button>
          <button type="button" onClick={() => setMode('register')} style={{ flex: 1, border: 'none', padding: '10px 12px', background: mode === 'register' ? 'var(--sh-teal-bg)' : 'transparent', color: 'var(--sh-text-main)', fontWeight: 600, cursor: 'pointer' }}>Register</button>
        </div>

        {/* ── Google OAuth ───────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={isGoogleLoading}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            width: '100%',
            padding: '10px 16px',
            marginBottom: 16,
            border: '1px solid var(--sh-border)',
            borderRadius: 'var(--sh-radius-lg)',
            background: 'var(--sh-surface)',
            color: 'var(--sh-text-main)',
            fontWeight: 600,
            fontSize: 14,
            cursor: isGoogleLoading ? 'not-allowed' : 'pointer',
            opacity: isGoogleLoading ? 0.7 : 1,
          }}
        >
          {/* Google 'G' logo SVG */}
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            <path fill="none" d="M0 0h48v48H0z"/>
          </svg>
          {isGoogleLoading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        {/* ── Divider ───────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--sh-border)' }} />
          <span style={{ color: 'var(--sh-text-muted)', fontSize: 12 }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'var(--sh-border)' }} />
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

        <button
          type="button"
          className="sh-btn-secondary"
          onClick={() => navigate('/')}
          style={{ width: '100%', marginTop: 12 }}
        >
          ← Back to homepage
        </button>

      </div>
    </section>
  )
}
