import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  resolveLandingVariantId,
  trackHeroCtaClick,
  trackLandingView,
  trackPricingTeaserClick,
  trackSignupStart,
  trackSupportingCtaClick,
} from '../lib/landingAnalytics'
import { ROUTES } from '../lib/routes'

const SECTION_CONTAINER_STYLE = {
  maxWidth: 960,
  margin: '0 auto',
  padding: '0 20px 48px',
}

/** Set to a real URL (e.g. YouTube embed) when demo video is ready. */
const DEMO_VIDEO_URL = ''

export function LandingPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const howItWorksRef = useRef<HTMLElement | null>(null)
  const variantId = useMemo(() => resolveLandingVariantId(searchParams), [searchParams])
  const [showVideo, setShowVideo] = useState(false)

  const visualProofSteps = useMemo(
    () => [
      {
        img: '/landing/scan-step-1.webp',
        title: t('landing.visual_proof_step1_title'),
        desc: t('landing.visual_proof_step1_desc'),
      },
      {
        img: '/landing/scan-step-2.webp',
        title: t('landing.visual_proof_step2_title'),
        desc: t('landing.visual_proof_step2_desc'),
      },
      {
        img: '/landing/scan-step-3.webp',
        title: t('landing.visual_proof_step3_title'),
        desc: t('landing.visual_proof_step3_desc'),
      },
    ],
    [t],
  )

  useEffect(() => {
    trackLandingView(variantId, i18n.language)
  }, [i18n.language, variantId])

  function handleSignupCtaClick(sourceSection: string, ctaLabel: string, isHero: boolean): void {
    trackSignupStart(sourceSection, ctaLabel, variantId)
    if (isHero) {
      trackHeroCtaClick(ctaLabel, variantId)
    } else {
      trackSupportingCtaClick(ctaLabel, sourceSection)
    }
    navigate(ROUTES.login)
  }

  const howItWorksSteps = useMemo(
    () => [
      {
        title: t('landing.how_step_1_title'),
        description: t('landing.how_step_1_desc'),
      },
      {
        title: t('landing.how_step_2_title'),
        description: t('landing.how_step_2_desc'),
      },
      {
        title: t('landing.how_step_3_title'),
        description: t('landing.how_step_3_desc'),
      },
    ],
    [t],
  )

  return (
    <div
      style={{ minHeight: '100vh', background: 'var(--sh-bg)', display: 'flex', flexDirection: 'column' }}
      data-landing-variant={variantId}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 20px',
          borderBottom: '1px solid var(--sh-border)',
          background: 'var(--sh-surface)',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>📚 Shelfy</span>
        <button
          type='button'
          className='sh-btn-secondary'
          style={{ fontSize: 14 }}
          onClick={() => {
            trackSupportingCtaClick(t('landing.hero_cta_login'), 'header')
            navigate(ROUTES.login)
          }}
        >
          {t('landing.hero_cta_login')}
        </button>
      </header>

      <main style={{ flex: 1, paddingTop: 36 }}>
        <section
          style={{
            ...SECTION_CONTAINER_STYLE,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
            alignItems: 'stretch',
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 'clamp(30px, 5vw, 44px)',
                fontWeight: 800,
                lineHeight: 1.15,
                margin: '0 0 12px',
              }}
            >
              {t('landing.hero_title')}
            </h1>
            <p style={{ color: 'var(--sh-text-secondary)', margin: '0 0 20px', lineHeight: 1.55 }}>
              {t('landing.hero_subtitle')}
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type='button'
                className='sh-btn-primary'
                onClick={() => handleSignupCtaClick('hero', t('landing.hero_cta_signup'), true)}
              >
                {t('landing.hero_cta_signup')}
              </button>
              <button
                type='button'
                className='sh-btn-secondary'
                onClick={() => {
                  trackSupportingCtaClick(t('landing.hero_cta_watch_demo'), 'hero')
                  howItWorksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
              >
                {t('landing.hero_cta_watch_demo')}
              </button>
            </div>
          </div>

          <aside
            style={{
              border: '1px solid var(--sh-border)',
              borderRadius: 'var(--sh-radius-lg)',
              background: 'var(--sh-surface)',
              padding: 16,
              boxShadow: 'var(--sh-shadow-sm)',
              alignSelf: 'start',
            }}
          >
            <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>{t('landing.hero_visual_header')}</h2>
            <ul style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 8, color: 'var(--sh-text-secondary)' }}>
              <li>{t('landing.hero_visual_line_1')}</li>
              <li>{t('landing.hero_visual_line_2')}</li>
            </ul>
            <p
              style={{
                margin: '12px 0 0',
                padding: '8px 10px',
                borderRadius: 'var(--sh-radius-md)',
                background: 'var(--sh-primary-bg)',
                color: 'var(--sh-primary-text)',
                fontSize: 14,
              }}
            >
              {t('landing.hero_visual_result')}
            </p>
          </aside>
        </section>

        <section ref={howItWorksRef} style={SECTION_CONTAINER_STYLE}>
          <h2 style={{ fontSize: 'clamp(22px, 4vw, 32px)', margin: '0 0 8px' }}>{t('landing.how_title')}</h2>
          <p style={{ margin: '0 0 16px', color: 'var(--sh-text-secondary)' }}>{t('landing.how_subtitle')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            {howItWorksSteps.map((step, index) => (
              <article
                key={step.title}
                style={{
                  border: '1px solid var(--sh-border)',
                  borderRadius: 'var(--sh-radius-md)',
                  background: 'var(--sh-surface)',
                  padding: '12px 14px',
                }}
              >
                <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: 'var(--sh-primary-text)' }}>
                  {t('landing.how_step_label', { count: index + 1 })}
                </p>
                <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>{step.title}</h3>
                <p style={{ margin: 0, color: 'var(--sh-text-secondary)', fontSize: 14 }}>{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section style={SECTION_CONTAINER_STYLE} data-testid='visual-proof'>
          <h2 style={{ fontSize: 'clamp(22px, 4vw, 32px)', margin: '0 0 16px' }}>
            {t('landing.visual_proof_title')}
          </h2>

          {/* Hero screenshot / poster */}
          <div
            style={{
              position: 'relative',
              borderRadius: 'var(--sh-radius-lg)',
              overflow: 'hidden',
              border: '1px solid var(--sh-border)',
              boxShadow: 'var(--sh-shadow-md)',
              background: 'var(--sh-surface)',
              marginBottom: 20,
            }}
          >
            <img
              src='/landing/demo-poster.webp'
              alt={t('landing.visual_proof_title')}
              style={{ width: '100%', display: 'block', maxHeight: 420, objectFit: 'cover' }}
            />
            <button
              type='button'
              onClick={() => {
                trackSupportingCtaClick(t('landing.visual_proof_play_demo'), 'visual_proof')
                if (DEMO_VIDEO_URL) setShowVideo(true)
              }}
              style={{
                position: 'absolute',
                bottom: 16,
                right: 16,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(0,0,0,0.7)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--sh-radius-pill)',
                padding: '8px 16px',
                fontSize: 14,
                fontWeight: 600,
                cursor: DEMO_VIDEO_URL ? 'pointer' : 'default',
                backdropFilter: 'blur(6px)',
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>▶</span>
              {DEMO_VIDEO_URL ? t('landing.visual_proof_play_demo') : t('landing.visual_proof_demo_coming')}
            </button>
          </div>

          {/* 3-step thumbnail row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            {visualProofSteps.map((step, i) => (
              <article
                key={step.title}
                style={{
                  border: '1px solid var(--sh-border)',
                  borderRadius: 'var(--sh-radius-md)',
                  background: 'var(--sh-surface)',
                  padding: 10,
                  textAlign: 'center',
                }}
              >
                <img
                  src={step.img}
                  alt={step.title}
                  style={{
                    width: '100%',
                    height: 60,
                    objectFit: 'cover',
                    borderRadius: 'var(--sh-radius-sm)',
                    marginBottom: 8,
                    background: 'var(--sh-border)',
                  }}
                />
                <p
                  style={{
                    margin: '0 0 4px',
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--sh-primary-text)',
                  }}
                >
                  {t('landing.how_step_label', { count: i + 1 })}
                </p>
                <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{step.title}</h3>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--sh-text-secondary)' }}>
                  {step.desc}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* Video lightbox modal */}
        {showVideo && (
          <div
            className='sh-modal-overlay'
            role='dialog'
            aria-modal='true'
            onClick={() => setShowVideo(false)}
          >
            <div
              className='sh-modal-panel sh-modal-panel--lg'
              style={{ padding: 0, overflow: 'hidden' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ position: 'relative', paddingTop: '56.25%', background: '#000' }}>
                {DEMO_VIDEO_URL ? (
                  <iframe
                    src={DEMO_VIDEO_URL}
                    title={t('landing.visual_proof_play_demo')}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      border: 'none',
                    }}
                    allow='autoplay; encrypted-media'
                    allowFullScreen
                  />
                ) : (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                    }}
                  >
                    <img
                      src='/landing/demo-poster.webp'
                      alt=''
                      style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.4 }}
                    />
                    <p style={{ position: 'absolute', fontSize: 18, fontWeight: 600 }}>
                      {t('landing.visual_proof_demo_coming')}
                    </p>
                  </div>
                )}
              </div>
              <button
                type='button'
                className='sh-btn-secondary'
                style={{ margin: 12 }}
                onClick={() => setShowVideo(false)}
              >
                {t('landing.visual_proof_close')}
              </button>
            </div>
          </div>
        )}

        <section style={SECTION_CONTAINER_STYLE}>
          <h2 style={{ fontSize: 'clamp(22px, 4vw, 32px)', margin: '0 0 8px' }}>{t('landing.summary_title')}</h2>
          <p style={{ margin: '0 0 16px', color: 'var(--sh-text-secondary)' }}>{t('landing.summary_subtitle')}</p>
          <div
            style={{
              display: 'grid',
              gap: 10,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              marginBottom: 12,
            }}
          >
            <article
              style={{
                border: '1px solid var(--sh-border)',
                borderRadius: 'var(--sh-radius-md)',
                background: 'var(--sh-surface)',
                padding: '12px 14px',
              }}
            >
              <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>{t('landing.summary_trust_title')}</h3>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--sh-text-secondary)' }}>{t('landing.summary_trust_desc')}</p>
            </article>
            <article
              style={{
                border: '1px solid var(--sh-border)',
                borderRadius: 'var(--sh-radius-md)',
                background: 'var(--sh-surface)',
                padding: '12px 14px',
              }}
            >
              <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>{t('landing.summary_pricing_title')}</h3>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--sh-text-secondary)' }}>
                {t('landing.summary_pricing_desc')}
              </p>
            </article>
          </div>
          <button
            type='button'
            className='sh-btn-secondary'
            onClick={() => {
              trackPricingTeaserClick(t('landing.summary_pricing_cta'), variantId)
              navigate(ROUTES.pricing)
            }}
          >
            {t('landing.summary_pricing_cta')}
          </button>
        </section>

        <section style={{ ...SECTION_CONTAINER_STYLE, paddingBottom: 72 }}>
          <div
            style={{
              border: '1px solid color-mix(in srgb, var(--sh-primary) 30%, var(--sh-border))',
              borderRadius: 'var(--sh-radius-xl)',
              padding: '24px 20px',
              background:
                'linear-gradient(160deg, color-mix(in srgb, var(--sh-primary-bg) 70%, white), var(--sh-surface) 55%)',
              textAlign: 'center',
            }}
          >
            <h2 style={{ fontSize: 'clamp(22px, 4vw, 32px)', margin: '0 0 8px' }}>{t('landing.final_cta_title')}</h2>
            <p style={{ margin: '0 0 16px', color: 'var(--sh-text-secondary)' }}>{t('landing.final_cta_subtitle')}</p>
            <button
              type='button'
              className='sh-btn-primary'
              onClick={() => handleSignupCtaClick('final_cta', t('landing.final_cta_button'), false)}
            >
              {t('landing.final_cta_button')}
            </button>
          </div>
        </section>
      </main>

      <footer
        style={{
          borderTop: '1px solid var(--sh-border)',
          padding: '14px 20px',
          display: 'flex',
          justifyContent: 'center',
          gap: 18,
          flexWrap: 'wrap',
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
      </footer>
    </div>
  )
}
