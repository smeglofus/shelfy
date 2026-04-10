/**
 * LandingPage — Clean, demo-first landing for Shelfy.
 *
 * Sections: Hero, How it works, Visual proof, Pricing teaser, FAQ, Final CTA.
 *
 * Design goals:
 *  - Airy layout with generous whitespace
 *  - Demo / "try it" is the primary CTA everywhere
 *  - Less boxy — cards only where they earn their keep
 *  - Mobile-first responsive grid
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  resolveLandingVariantId,
  trackFaqExpand,
  trackHeroCtaClick,
  trackLandingView,
  trackPricingTeaserClick,
  trackSignupStart,
  trackSupportingCtaClick,
} from '../lib/landingAnalytics'
import { ROUTES } from '../lib/routes'

/** Set to a real URL (e.g. YouTube embed) when demo video is ready. */
const DEMO_VIDEO_URL = ''

const FAQ_ITEMS = [
  { id: 'scanning', topic: 'how_scanning_works' },
  { id: 'privacy', topic: 'data_privacy' },
  { id: 'ai_mistakes', topic: 'ai_accuracy' },
  { id: 'free', topic: 'free_tier' },
  { id: 'sharing', topic: 'family_sharing' },
] as const

export function LandingPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const howItWorksRef = useRef<HTMLElement | null>(null)
  const variantId = useMemo(() => resolveLandingVariantId(searchParams), [searchParams])
  const [showVideo, setShowVideo] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)

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
      { title: t('landing.how_step_1_title'), description: t('landing.how_step_1_desc') },
      { title: t('landing.how_step_2_title'), description: t('landing.how_step_2_desc') },
      { title: t('landing.how_step_3_title'), description: t('landing.how_step_3_desc') },
    ],
    [t],
  )

  const visualProofSteps = useMemo(
    () => [
      { img: '/landing/scan-step-1.webp', title: t('landing.visual_proof_step1_title'), desc: t('landing.visual_proof_step1_desc') },
      { img: '/landing/scan-step-2.webp', title: t('landing.visual_proof_step2_title'), desc: t('landing.visual_proof_step2_desc') },
      { img: '/landing/scan-step-3.webp', title: t('landing.visual_proof_step3_title'), desc: t('landing.visual_proof_step3_desc') },
    ],
    [t],
  )

  return (
    <div
      style={{ minHeight: '100vh', background: 'var(--sh-bg)', display: 'flex', flexDirection: 'column' }}
      data-landing-variant={variantId}
    >
      {/* ── Header ── */}
      <header className="lp-header">
        <span style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>Shelfy</span>
        <button
          type="button"
          className="sh-btn-ghost"
          style={{ fontSize: 14 }}
          onClick={() => {
            trackSupportingCtaClick(t('landing.hero_cta_login'), 'header')
            navigate(ROUTES.login)
          }}
        >
          {t('landing.hero_cta_login')}
        </button>
      </header>

      <main style={{ flex: 1 }}>
        {/* ── Hero ── */}
        <section className="lp-section lp-hero">
          <h1 className="lp-hero-title">
            {t('landing.hero_title')}
          </h1>
          <p className="lp-hero-subtitle">
            {t('landing.hero_subtitle')}
          </p>
          <div className="lp-hero-actions">
            <button
              type="button"
              className="sh-btn-primary lp-btn-lg"
              onClick={() => handleSignupCtaClick('hero', t('landing.hero_cta_signup'), true)}
            >
              {t('landing.hero_cta_signup')}
            </button>
            <button
              type="button"
              className="sh-btn-ghost lp-btn-lg"
              onClick={() => {
                trackSupportingCtaClick(t('landing.hero_cta_watch_demo'), 'hero')
                howItWorksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              {t('landing.hero_cta_watch_demo')} &darr;
            </button>
          </div>
        </section>

        {/* ── How it works ── */}
        <section ref={howItWorksRef} className="lp-section">
          <h2 className="lp-section-title">{t('landing.how_title')}</h2>
          <p className="lp-section-subtitle">{t('landing.how_subtitle')}</p>

          <div className="lp-steps">
            {howItWorksSteps.map((step, index) => (
              <article key={step.title} className="lp-step">
                <span className="lp-step-number">{index + 1}</span>
                <div>
                  <h3 className="lp-step-title">{step.title}</h3>
                  <p className="lp-step-desc">{step.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── Visual proof ── */}
        <section className="lp-section" data-testid="visual-proof">
          <h2 className="lp-section-title">{t('landing.visual_proof_title')}</h2>

          {/* Poster image */}
          <div className="lp-poster-wrap">
            <img
              src="/landing/demo-poster.webp"
              alt={t('landing.visual_proof_title')}
              className="lp-poster-img"
            />
            <button
              type="button"
              className="lp-poster-play"
              onClick={() => {
                trackSupportingCtaClick(t('landing.visual_proof_play_demo'), 'visual_proof')
                if (DEMO_VIDEO_URL) setShowVideo(true)
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>&#9654;</span>
              {DEMO_VIDEO_URL ? t('landing.visual_proof_play_demo') : t('landing.visual_proof_demo_coming')}
            </button>
          </div>

          {/* 3-step thumbnails */}
          <div className="lp-proof-steps">
            {visualProofSteps.map((step, i) => (
              <article key={step.title} className="lp-proof-step">
                <img
                  src={step.img}
                  alt={step.title}
                  className="lp-proof-step-img"
                />
                <span className="lp-proof-step-label">
                  {t('landing.how_step_label', { count: i + 1 })}
                </span>
                <h3 className="lp-proof-step-title">{step.title}</h3>
                <p className="lp-proof-step-desc">{step.desc}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Video lightbox modal */}
        {showVideo && (
          <div
            className="sh-modal-overlay"
            role="dialog"
            aria-modal="true"
            onClick={() => setShowVideo(false)}
          >
            <div
              className="sh-modal-panel sh-modal-panel--lg"
              style={{ padding: 0, overflow: 'hidden' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ position: 'relative', paddingTop: '56.25%', background: '#000' }}>
                {DEMO_VIDEO_URL ? (
                  <iframe
                    src={DEMO_VIDEO_URL}
                    title={t('landing.visual_proof_play_demo')}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                  />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                    <img src="/landing/demo-poster.webp" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.4 }} />
                    <p style={{ position: 'absolute', fontSize: 18, fontWeight: 600 }}>
                      {t('landing.visual_proof_demo_coming')}
                    </p>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="sh-btn-secondary"
                style={{ margin: 12 }}
                onClick={() => setShowVideo(false)}
              >
                {t('landing.visual_proof_close')}
              </button>
            </div>
          </div>
        )}

        {/* ── Pricing teaser ── */}
        <section className="lp-section">
          <h2 className="lp-section-title">{t('landing.pricing_teaser_title')}</h2>
          <div className="lp-pricing-body">
            <p className="lp-pricing-desc">{t('landing.pricing_teaser_desc')}</p>
            <p className="lp-pricing-trust">{t('landing.pricing_teaser_trust')}</p>
            <button
              type="button"
              className="sh-btn-secondary"
              onClick={() => {
                trackPricingTeaserClick(t('landing.pricing_teaser_cta'), variantId)
                navigate(ROUTES.pricing)
              }}
            >
              {t('landing.pricing_teaser_cta')}
            </button>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="lp-section" data-testid="faq">
          <h2 className="lp-section-title">{t('landing.faq_title')}</h2>
          <div className="lp-faq-list">
            {FAQ_ITEMS.map((item, i) => {
              const isOpen = openFaq === i
              return (
                <div key={item.id} className="lp-faq-item">
                  <button
                    type="button"
                    className="lp-faq-trigger"
                    aria-expanded={isOpen}
                    onClick={() => {
                      const next = isOpen ? null : i
                      setOpenFaq(next)
                      if (next !== null) {
                        trackFaqExpand(item.id, item.topic)
                      }
                    }}
                  >
                    <span>{t(`landing.faq_${i + 1}_q`)}</span>
                    <span
                      className="lp-faq-chevron"
                      style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 6l4 4 4-4" />
                      </svg>
                    </span>
                  </button>
                  <div
                    className="lp-faq-answer"
                    style={{
                      maxHeight: isOpen ? 300 : 0,
                      opacity: isOpen ? 1 : 0,
                    }}
                  >
                    <p>{t(`landing.faq_${i + 1}_a`)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="lp-section" style={{ paddingBottom: 80 }}>
          <div className="lp-final-cta">
            <h2 className="lp-final-cta-title">{t('landing.final_cta_title')}</h2>
            <p className="lp-final-cta-subtitle">{t('landing.final_cta_subtitle')}</p>
            <button
              type="button"
              className="sh-btn-primary lp-btn-lg"
              onClick={() => handleSignupCtaClick('final_cta', t('landing.final_cta_button'), false)}
            >
              {t('landing.final_cta_button')}
            </button>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <button
          type="button"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 'inherit' }}
          onClick={() => navigate(ROUTES.privacy)}
        >
          {t('landing.footer_privacy')}
        </button>
        <button
          type="button"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 'inherit' }}
          onClick={() => navigate(ROUTES.terms)}
        >
          {t('landing.footer_terms')}
        </button>
      </footer>
    </div>
  )
}
