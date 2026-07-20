import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ROUTES } from '../lib/routes'
import { getConsent, setConsent } from '../lib/consent'
import { initAnalytics } from '../lib/analytics'

/**
 * Cookie/analytics consent banner.
 *
 * Shown once, until the user makes a choice. Non-essential analytics
 * (PostHog + Session Replay) stay off until "accept" is pressed. Per EDPB
 * guidance, declining is exactly as easy as accepting (two equal buttons).
 */
export function ConsentBanner() {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(() => getConsent() === null)

  if (!visible) return null

  function accept() {
    setConsent('granted')
    void initAnalytics()
    setVisible(false)
  }

  function decline() {
    setConsent('denied')
    setVisible(false)
  }

  return (
    <div
      role="dialog"
      aria-label={t('consent.aria_label')}
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10001,
        background: 'var(--sh-surface)',
        borderTop: '1px solid var(--sh-border)',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.08)',
        padding: '16px 20px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}
    >
      <p
        style={{
          margin: 0,
          flex: '1 1 320px',
          maxWidth: 640,
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--sh-text-main)',
        }}
      >
        {t('consent.message')}{' '}
        <a href={ROUTES.privacy} style={{ color: 'var(--sh-primary)' }}>
          {t('consent.learn_more')}
        </a>
      </p>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button type="button" className="sh-btn-secondary" style={{ fontSize: 13 }} onClick={decline}>
          {t('consent.decline')}
        </button>
        <button type="button" className="sh-btn-primary" style={{ fontSize: 13 }} onClick={accept}>
          {t('consent.accept')}
        </button>
      </div>
    </div>
  )
}
