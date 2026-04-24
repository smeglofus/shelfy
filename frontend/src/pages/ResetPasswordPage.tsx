import { useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import axios from 'axios'

import { useAuth } from '../contexts/AuthContext'
import { confirmPasswordReset } from '../lib/api'
import { useToastStore } from '../lib/toast-store'
import { ROUTES } from '../lib/routes'

const POLICY_MESSAGES = [
  'Password must be at least 10 characters long',
  'Password must contain at least one digit',
  'Password must contain at least one non-digit character',
]

function isPolicyError(message: string): boolean {
  return POLICY_MESSAGES.includes(message)
}

export function ResetPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { isAuthenticated } = useAuth()
  const showError = useToastStore((s) => s.showError)

  const token = useMemo(() => searchParams.get('token') ?? '', [searchParams])

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isAuthenticated) {
    return <Navigate to={ROUTES.books} replace />
  }

  return (
    <section style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'var(--sh-bg)' }}>
      <div style={{ background: 'var(--sh-surface)', padding: '40px 32px', borderRadius: 'var(--sh-radius-xl)', width: '100%', maxWidth: 420, boxShadow: 'var(--sh-shadow-lg)', border: '1px solid var(--sh-border)' }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>{t('auth.reset_password_title', 'Set new password')}</h1>
        <p style={{ marginTop: 0, marginBottom: 20, color: 'var(--sh-text-muted)' }}>
          {t('auth.reset_password_subtitle', 'Choose a strong password for your account.')}
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            setInlineError(null)

            if (!token) {
              showError(t('auth.reset_invalid_or_expired', 'This link is invalid or has expired. Please request a new one.'))
              return
            }

            if (password !== confirmPassword) {
              setInlineError(t('auth.password_mismatch', 'Passwords do not match.'))
              return
            }

            setIsSubmitting(true)
            confirmPasswordReset({ token, new_password: password })
              .then(() => {
                navigate(ROUTES.login, {
                  replace: true,
                  state: {
                    toastSuccess: t('auth.password_reset_success', 'Password reset successfully. Please sign in.'),
                  },
                })
              })
              .catch((error: unknown) => {
                if (axios.isAxiosError<{ detail?: string }>(error)) {
                  const detail = error.response?.data?.detail
                  if (typeof detail === 'string' && isPolicyError(detail)) {
                    setInlineError(detail)
                    return
                  }
                }

                showError(t('auth.reset_invalid_or_expired', 'This link is invalid or has expired. Please request a new one.'))
              })
              .finally(() => {
                setIsSubmitting(false)
              })
          }}
          style={{ display: 'grid', gap: 16 }}
        >
          <label style={{ display: 'grid', gap: 6 }}>
            <span>{t('auth.password_label', 'Password')}</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
              <input className='sh-input' required type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} />
              <button
                type='button'
                className='sh-btn-ghost'
                onClick={() => setShowPassword((v) => !v)}
                style={{ padding: '0 10px', fontSize: 12, whiteSpace: 'nowrap' }}
                aria-label={showPassword ? t('auth.hide_password', 'Hide') : t('auth.show_password', 'Show')}
              >
                {showPassword ? t('auth.hide_password', 'Hide') : t('auth.show_password', 'Show')}
              </button>
            </div>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span>{t('auth.confirm_password_label', 'Confirm password')}</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
              <input className='sh-input' required type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              <button
                type='button'
                className='sh-btn-ghost'
                onClick={() => setShowConfirmPassword((v) => !v)}
                style={{ padding: '0 10px', fontSize: 12, whiteSpace: 'nowrap' }}
                aria-label={showConfirmPassword ? t('auth.hide_password', 'Hide') : t('auth.show_password', 'Show')}
              >
                {showConfirmPassword ? t('auth.hide_password', 'Hide') : t('auth.show_password', 'Show')}
              </button>
            </div>
          </label>

          {inlineError && <p style={{ color: 'var(--sh-red)', margin: 0 }}>{inlineError}</p>}

          <button type='submit' className='sh-btn-primary' disabled={isSubmitting}>
            {isSubmitting ? t('auth.please_wait', 'Please wait…') : t('auth.reset_password_cta', 'Reset password')}
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
