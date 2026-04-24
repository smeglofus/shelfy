import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../contexts/AuthContext'
import { requestPasswordReset } from '../lib/api'
import { useToastStore } from '../lib/toast-store'
import { ROUTES } from '../lib/routes'

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const showSuccess = useToastStore((s) => s.showSuccess)

  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isAuthenticated) {
    return <Navigate to={ROUTES.books} replace />
  }

  return (
    <section style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'var(--sh-bg)' }}>
      <div style={{ background: 'var(--sh-surface)', padding: '40px 32px', borderRadius: 'var(--sh-radius-xl)', width: '100%', maxWidth: 420, boxShadow: 'var(--sh-shadow-lg)', border: '1px solid var(--sh-border)' }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>{t('auth.forgot_password_title', 'Forgot password')}</h1>
        <p style={{ marginTop: 0, marginBottom: 20, color: 'var(--sh-text-muted)' }}>
          {t('auth.forgot_password_subtitle', 'Enter your email and we will send you a password reset link.')}
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            setIsSubmitting(true)
            requestPasswordReset({ email })
              .finally(() => {
                showSuccess(t('auth.password_reset_request_success', "If an account exists for that email, we've sent a reset link. Check your inbox."))
                setIsSubmitting(false)
              })
          }}
          style={{ display: 'grid', gap: 16 }}
        >
          <label style={{ display: 'grid', gap: 6 }}>
            <span>{t('auth.email_label', 'Email')}</span>
            <input className='sh-input' required type='email' value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>

          <button type='submit' className='sh-btn-primary' disabled={isSubmitting}>
            {isSubmitting ? t('auth.please_wait', 'Please wait…') : t('auth.send_reset_link', 'Send reset link')}
          </button>
        </form>

        <button
          type='button'
          className='sh-btn-secondary'
          onClick={() => navigate(ROUTES.login)}
          style={{ width: '100%', marginTop: 12 }}
        >
          ← {t('auth.back_to_login', 'Back to sign in')}
        </button>
      </div>
    </section>
  )
}
