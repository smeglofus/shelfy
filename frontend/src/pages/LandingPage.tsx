import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../lib/routes'

const FEATURE_ICON_STYLE: CSSProperties = {
  fontSize: 36,
  marginBottom: 12,
}

const FEATURE_CARD_STYLE: CSSProperties = {
  flex: '1 1 240px',
  padding: '24px 20px',
  borderRadius: 'var(--sh-radius-lg)',
  border: '1px solid var(--sh-border)',
  background: 'var(--sh-surface)',
  boxShadow: 'var(--sh-shadow-sm)',
}

export function LandingPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sh-bg)', display: 'flex', flexDirection: 'column' }}>
      {/* ── Top bar ── */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 24px',
          borderBottom: '1px solid var(--sh-border)',
          background: 'var(--sh-surface)',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>📚 Shelfy</span>
        <button
          type='button'
          className='sh-btn-secondary'
          style={{ fontSize: 14 }}
          onClick={() => navigate(ROUTES.login)}
        >
          {t('landing.hero_cta_login')}
        </button>
      </header>

      {/* ── Hero ── */}
      <main style={{ flex: 1 }}>
        <section
          style={{
            maxWidth: 720,
            margin: '0 auto',
            padding: '72px 24px 56px',
            textAlign: 'center',
          }}
        >
          <h1
            style={{
              fontSize: 'clamp(28px, 5vw, 48px)',
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: '-0.03em',
              margin: '0 0 20px',
            }}
          >
            {t('landing.hero_title')}
          </h1>
          <p
            style={{
              fontSize: 'clamp(15px, 2vw, 18px)',
              color: 'var(--sh-text-secondary)',
              maxWidth: 560,
              margin: '0 auto 32px',
              lineHeight: 1.6,
            }}
          >
            {t('landing.hero_subtitle')}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type='button'
              className='sh-btn-primary'
              style={{ fontSize: 16, padding: '12px 28px' }}
              onClick={() => navigate(ROUTES.login)}
            >
              {t('landing.hero_cta_signup')}
            </button>
            <button
              type='button'
              className='sh-btn-secondary'
              style={{ fontSize: 16, padding: '12px 28px' }}
              onClick={() => navigate(ROUTES.pricing)}
            >
              {t('landing.see_pricing')}
            </button>
          </div>
        </section>

        {/* ── Features ── */}
        <section
          style={{
            maxWidth: 960,
            margin: '0 auto',
            padding: '0 24px 80px',
            display: 'flex',
            gap: 20,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <div style={FEATURE_CARD_STYLE}>
            <div style={FEATURE_ICON_STYLE}>📷</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700 }}>
              {t('landing.feature_scan_title')}
            </h3>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--sh-text-secondary)', lineHeight: 1.55 }}>
              {t('landing.feature_scan_desc')}
            </p>
          </div>

          <div style={FEATURE_CARD_STYLE}>
            <div style={FEATURE_ICON_STYLE}>✨</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700 }}>
              {t('landing.feature_enrich_title')}
            </h3>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--sh-text-secondary)', lineHeight: 1.55 }}>
              {t('landing.feature_enrich_desc')}
            </p>
          </div>

          <div style={FEATURE_CARD_STYLE}>
            <div style={FEATURE_ICON_STYLE}>👥</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700 }}>
              {t('landing.feature_share_title')}
            </h3>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--sh-text-secondary)', lineHeight: 1.55 }}>
              {t('landing.feature_share_desc')}
            </p>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer
        style={{
          borderTop: '1px solid var(--sh-border)',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'center',
          gap: 24,
          fontSize: 13,
          color: 'var(--sh-text-secondary)',
        }}
      >
        <button
          type='button'
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 'inherit' }}
          onClick={() => navigate(ROUTES.privacy)}
        >
          {t('landing.footer_privacy')}
        </button>
        <button
          type='button'
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 'inherit' }}
          onClick={() => navigate(ROUTES.terms)}
        >
          {t('landing.footer_terms')}
        </button>
        <span>© {new Date().getFullYear()} Shelfy</span>
      </footer>
    </div>
  )
}
