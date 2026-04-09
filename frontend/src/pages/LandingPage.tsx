import type { CSSProperties } from 'react'
import { useMemo, useRef } from 'react'
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
  const howItWorksRef = useRef<HTMLElement | null>(null)

  const howItWorksSteps = useMemo(
    () => [
      {
        title: t('landing.how_step_1_title'),
        description: t('landing.how_step_1_desc'),
        emoji: '📸',
      },
      {
        title: t('landing.how_step_2_title'),
        description: t('landing.how_step_2_desc'),
        emoji: '🤖',
      },
      {
        title: t('landing.how_step_3_title'),
        description: t('landing.how_step_3_desc'),
        emoji: '📚',
      },
    ],
    [t],
  )

  const proofItems = useMemo(
    () => [
      {
        title: t('landing.proof_card_1_title'),
        description: t('landing.proof_card_1_desc'),
        metric: t('landing.proof_card_1_metric'),
      },
      {
        title: t('landing.proof_card_2_title'),
        description: t('landing.proof_card_2_desc'),
        metric: t('landing.proof_card_2_metric'),
      },
      {
        title: t('landing.proof_card_3_title'),
        description: t('landing.proof_card_3_desc'),
        metric: t('landing.proof_card_3_metric'),
      },
    ],
    [t],
  )

  const trustSignals = useMemo(
    () => [
      { title: t('landing.trust_signal_1_title'), description: t('landing.trust_signal_1_desc') },
      { title: t('landing.trust_signal_2_title'), description: t('landing.trust_signal_2_desc') },
      { title: t('landing.trust_signal_3_title'), description: t('landing.trust_signal_3_desc') },
    ],
    [t],
  )

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
            maxWidth: 1120,
            margin: '0 auto',
            padding: '72px 24px 64px',
            display: 'flex',
            gap: 24,
            flexWrap: 'wrap',
            alignItems: 'stretch',
          }}
        >
          <div style={{ flex: '1 1 460px' }}>
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
                margin: '0 0 32px',
                lineHeight: 1.6,
              }}
            >
              {t('landing.hero_subtitle')}
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
                onClick={() => howItWorksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                {t('landing.hero_cta_watch_demo')}
              </button>
            </div>
          </div>

          <div
            style={{
              flex: '1 1 420px',
              padding: 20,
              borderRadius: 'var(--sh-radius-xl)',
              border: '1px solid var(--sh-border)',
              background:
                'linear-gradient(160deg, color-mix(in srgb, var(--sh-primary) 14%, white), var(--sh-surface) 42%)',
              boxShadow: 'var(--sh-shadow-md)',
            }}
          >
            <div
              style={{
                borderRadius: 'var(--sh-radius-lg)',
                border: '1px solid color-mix(in srgb, var(--sh-primary) 16%, var(--sh-border))',
                background: 'var(--sh-surface)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  background: 'color-mix(in srgb, var(--sh-primary) 16%, white)',
                  padding: '10px 14px',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {t('landing.hero_visual_header')}
              </div>
              <div style={{ padding: 16, display: 'grid', gap: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--sh-text-secondary)' }}>{t('landing.hero_visual_line_1')}</div>
                <div style={{ fontSize: 13, color: 'var(--sh-text-secondary)' }}>{t('landing.hero_visual_line_2')}</div>
                <div
                  style={{
                    marginTop: 2,
                    background: 'var(--sh-primary-bg)',
                    color: 'var(--sh-primary-text)',
                    borderRadius: 'var(--sh-radius-md)',
                    padding: '10px 12px',
                    fontSize: 13,
                    border: '1px solid color-mix(in srgb, var(--sh-primary) 20%, var(--sh-border))',
                  }}
                >
                  {t('landing.hero_visual_result')}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Jak to funguje ── */}
        <section
          ref={howItWorksRef}
          style={{
            maxWidth: 1120,
            margin: '0 auto',
            padding: '0 24px 56px',
          }}
        >
          <h2 style={{ fontSize: 'clamp(24px, 4vw, 34px)', margin: '0 0 10px' }}>{t('landing.how_title')}</h2>
          <p style={{ margin: '0 0 24px', color: 'var(--sh-text-secondary)' }}>{t('landing.how_subtitle')}</p>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {howItWorksSteps.map((step, index) => (
              <article key={step.title} style={{ ...FEATURE_CARD_STYLE, minHeight: 200 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>{step.emoji}</div>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--sh-primary-text)', marginBottom: 6 }}>
                  {t('landing.how_step_label', { count: index + 1 })}
                </p>
                <h3 style={{ margin: '0 0 8px', fontSize: 17 }}>{step.title}</h3>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--sh-text-secondary)', lineHeight: 1.55 }}>
                  {step.description}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Product proof ── */}
        <section
          style={{
            maxWidth: 1120,
            margin: '0 auto',
            padding: '0 24px 44px',
          }}
        >
          <h2 style={{ fontSize: 'clamp(24px, 4vw, 34px)', margin: '0 0 10px' }}>{t('landing.proof_title')}</h2>
          <p style={{ margin: '0 0 24px', color: 'var(--sh-text-secondary)' }}>{t('landing.proof_subtitle')}</p>
          <div style={{ display: 'grid', gap: 14 }}>
            {proofItems.map((item) => (
              <article
                key={item.title}
                style={{
                  border: '1px solid var(--sh-border)',
                  borderRadius: 'var(--sh-radius-lg)',
                  background: 'var(--sh-surface)',
                  boxShadow: 'var(--sh-shadow-sm)',
                  padding: 16,
                }}
              >
                <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: 'var(--sh-primary-text)' }}>
                  {item.metric}
                </p>
                <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>{item.title}</h3>
                <p style={{ margin: 0, color: 'var(--sh-text-secondary)', fontSize: 14, lineHeight: 1.55 }}>
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Before / After ── */}
        <section
          style={{
            maxWidth: 1120,
            margin: '0 auto',
            padding: '0 24px 44px',
          }}
        >
          <h2 style={{ fontSize: 'clamp(24px, 4vw, 34px)', margin: '0 0 10px' }}>{t('landing.before_after_title')}</h2>
          <p style={{ margin: '0 0 24px', color: 'var(--sh-text-secondary)' }}>{t('landing.before_after_subtitle')}</p>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <article
              style={{
                ...FEATURE_CARD_STYLE,
                borderColor: 'color-mix(in srgb, var(--sh-danger) 30%, var(--sh-border))',
              }}
            >
              <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: 'var(--sh-text-secondary)' }}>
                {t('landing.before_label')}
              </p>
              <h3 style={{ margin: '0 0 8px', fontSize: 17 }}>{t('landing.before_title')}</h3>
              <p style={{ margin: 0, color: 'var(--sh-text-secondary)', fontSize: 14, lineHeight: 1.55 }}>
                {t('landing.before_desc')}
              </p>
            </article>
            <article
              style={{
                ...FEATURE_CARD_STYLE,
                borderColor: 'color-mix(in srgb, var(--sh-primary) 30%, var(--sh-border))',
                background: 'color-mix(in srgb, var(--sh-primary-bg) 35%, var(--sh-surface))',
              }}
            >
              <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: 'var(--sh-primary-text)' }}>
                {t('landing.after_label')}
              </p>
              <h3 style={{ margin: '0 0 8px', fontSize: 17 }}>{t('landing.after_title')}</h3>
              <p style={{ margin: 0, color: 'var(--sh-text-secondary)', fontSize: 14, lineHeight: 1.55 }}>
                {t('landing.after_desc')}
              </p>
            </article>
          </div>
        </section>

        {/* ── Trust signals ── */}
        <section
          style={{
            maxWidth: 1120,
            margin: '0 auto',
            padding: '0 24px 44px',
          }}
        >
          <h2 style={{ fontSize: 'clamp(24px, 4vw, 34px)', margin: '0 0 10px' }}>{t('landing.trust_title')}</h2>
          <p style={{ margin: '0 0 24px', color: 'var(--sh-text-secondary)' }}>{t('landing.trust_subtitle')}</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {trustSignals.map((signal) => (
              <article
                key={signal.title}
                style={{
                  flex: '1 1 250px',
                  border: '1px solid var(--sh-border)',
                  borderRadius: 'var(--sh-radius-md)',
                  padding: '14px 16px',
                  background: 'var(--sh-surface)',
                }}
              >
                <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{signal.title}</h3>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--sh-text-secondary)' }}>
                  {signal.description}
                </p>
              </article>
            ))}
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
