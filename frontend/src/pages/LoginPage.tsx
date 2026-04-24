import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../contexts/AuthContext'
import { formatApiError, getGoogleAuthorizeUrl } from '../lib/api'
import { trackEvent } from '../lib/analytics'
import {
  resolvePostLoginDestination,
  type PostLoginRouteState,
} from '../lib/post-login-destination'

type AuthMode = 'signin' | 'register'

export function LoginPage() {
  const { t } = useTranslation()
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

  const passwordChecks = {
    length: password.length >= 10,
    digit: /\d/.test(password),
    nonDigit: /\D/.test(password),
  }

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
          <button type="button" onClick={() => setMode('signin')} style={{ flex: 1, border: 'none', padding: '10px 12px', background: mode === 'signin' ? 'var(--sh-teal-bg)' : 'transparent', color: 'var(--sh-text-main)', fontWeight: 600, cursor: 'pointer' }}>{t('auth.signin_tab', 'Sign in')}</button>
          <button type="button" onClick={() => setMode('register')} style={{ flex: 1, border: 'none', padding: '10px 12px', background: mode === 'register' ? 'var(--sh-teal-bg)' : 'transparent', color: 'var(--sh-text-main)', fontWeight: 600, cursor: 'pointer' }}>{t('auth.register_tab', 'Register')}</button>
        </div>

        <div style={{ marginBottom: 14, color: 'var(--sh-text-muted)', fontSize: 13, lineHeight: 1.45 }}>
          <div style={{ color: 'var(--sh-text-main)', fontWeight: 600, marginBottom: 4 }}>
            {t('auth.intro_title', 'Create your Shelfy account in under a minute')}
          </div>
          <div>
            {t('auth.intro_subtitle', 'Free plan includes up to 200 books and 5 shelf scans per month. You can upgrade anytime.')}
          </div>
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
          {isGoogleLoading ? t('auth.redirecting', 'Redirecting…') : t('auth.continue_google', 'Continue with Google')}
        </button>

        {/* ── Divider ───────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--sh-border)' }} />
          <span style={{ color: 'var(--sh-text-muted)', fontSize: 12 }}>{t('auth.or', 'or')}</span>
          <div style={{ flex: 1, height: 1, background: 'var(--sh-border)' }} />
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)

            if (mode === 'register' && password !== confirmPassword) {
              setError(t('auth.password_mismatch', 'Passwords do not match.'))
              return
            }

            setIsSubmitting(true)
            const authAction = mode === 'signin' ? login(email, password) : register(email, password)

            authAction
              .then(() => {
                const state = location.state as PostLoginRouteState | undefined
                navigate(resolvePostLoginDestination(state), { replace: true })
              })
              .catch((authError: unknown) => {
                setError(formatApiError(authError))
              })
              .finally(() => setIsSubmitting(false))
          }}
          style={{ display: 'grid', gap: 16 }}
        >
          <label style={{ display: 'grid', gap: 6 }}>
            <span>{t('auth.email_label', 'Email')}</span>
            <input className="sh-input" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span>{t('auth.password_label', 'Password')}</span>
            <input className="sh-input" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>

          {mode === 'register' && (
            <div
              style={{
                marginTop: -8,
                fontSize: 12,
                color: 'var(--sh-text-muted)',
                background: 'var(--sh-surface-elevated)',
                border: '1px solid var(--sh-border)',
                borderRadius: 'var(--sh-radius-md)',
                padding: '8px 10px',
                display: 'grid',
                gap: 4,
              }}
            >
              <div style={{ color: passwordChecks.length ? 'var(--sh-teal)' : 'var(--sh-text-muted)' }}>
                {passwordChecks.length ? '✓' : '•'} {t('auth.pw_rule_len', 'Min. 10 characters')}
              </div>
              <div style={{ color: passwordChecks.digit ? 'var(--sh-teal)' : 'var(--sh-text-muted)' }}>
                {passwordChecks.digit ? '✓' : '•'} {t('auth.pw_rule_digit', 'At least 1 digit')}
              </div>
              <div style={{ color: passwordChecks.nonDigit ? 'var(--sh-teal)' : 'var(--sh-text-muted)' }}>
                {passwordChecks.nonDigit ? '✓' : '•'} {t('auth.pw_rule_non_digit', 'At least 1 letter/symbol')}
              </div>
            </div>
          )}

          {mode === 'register' && (
            <label style={{ display: 'grid', gap: 6 }}>
              <span>{t('auth.confirm_password_label', 'Confirm password')}</span>
              <input className="sh-input" required type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </label>
          )}

          {error && <p style={{ color: 'var(--sh-red)', margin: 0 }}>{error}</p>}

          <button type="submit" className="sh-btn-primary" disabled={isSubmitting}>
            {isSubmitting ? t('auth.please_wait', 'Please wait…') : mode === 'signin' ? t('auth.signin_cta', 'Sign in') : t('auth.register_cta', 'Register')}
          </button>
        </form>

        <button
          type="button"
          className="sh-btn-secondary"
          onClick={() => navigate('/')}
          style={{ width: '100%', marginTop: 12 }}
        >
          ← {t('auth.back_home', 'Back to homepage')}
        </button>

      </div>
    </section>
  )
}
