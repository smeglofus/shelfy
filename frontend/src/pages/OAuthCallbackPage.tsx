/**
 * OAuthCallbackPage — handles the redirect from Google after user consent.
 *
 * Google redirects to /auth/callback?code=…&state=…
 * This page extracts the params, calls the backend, and on success navigates
 * the user to /books (or wherever they were heading before).
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '../contexts/AuthContext'
import { formatApiError } from '../lib/api'
import { trackEvent } from '../lib/analytics'
import { ROUTES } from '../lib/routes'

export function OAuthCallbackPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { loginWithGoogle } = useAuth()
  const [error, setError] = useState<string | null>(null)
  // Prevent double-invocation in React StrictMode
  const calledRef = useRef(false)

  useEffect(() => {
    if (calledRef.current) return
    calledRef.current = true

    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const errorParam = searchParams.get('error')

    // User denied consent on Google's side
    if (errorParam) {
      trackEvent('oauth_google_error', { reason: errorParam })
      navigate(ROUTES.login, { replace: true })
      return
    }

    if (!code || !state) {
      setError('Missing OAuth parameters. Please try signing in again.')
      return
    }

    loginWithGoogle(code, state)
      .then(() => {
        trackEvent('oauth_google_success')
        navigate(ROUTES.books, { replace: true })
      })
      .catch((err: unknown) => {
        trackEvent('oauth_google_error', { reason: formatApiError(err) })
        setError(formatApiError(err))
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // ^ searchParams / loginWithGoogle are stable; intentionally run only once.

  if (error) {
    return (
      <section
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          background: 'var(--sh-bg)',
        }}
      >
        <p style={{ color: 'var(--sh-red)', maxWidth: 360, textAlign: 'center' }}>{error}</p>
        <button
          type="button"
          className="sh-btn-primary"
          onClick={() => navigate(ROUTES.login, { replace: true })}
        >
          Back to sign in
        </button>
      </section>
    )
  }

  return (
    <section
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--sh-bg)',
      }}
    >
      <p style={{ color: 'var(--sh-text-muted)' }}>Signing you in…</p>
    </section>
  )
}
