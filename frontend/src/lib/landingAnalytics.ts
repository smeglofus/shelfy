import { trackEvent } from './analytics'

const LANDING_VARIANT_QUERY_KEYS = ['lp_variant', 'variant']
const DEFAULT_VARIANT_ID = 'control'

function sanitizeVariantId(input: string | null): string {
  if (!input) return DEFAULT_VARIANT_ID
  const normalized = input.trim().toLowerCase()
  if (!normalized) return DEFAULT_VARIANT_ID
  if (!/^[a-z0-9_-]{1,48}$/.test(normalized)) return DEFAULT_VARIANT_ID
  return normalized
}

export function resolveLandingVariantId(searchParams: URLSearchParams): string {
  for (const key of LANDING_VARIANT_QUERY_KEYS) {
    const candidate = sanitizeVariantId(searchParams.get(key))
    if (candidate !== DEFAULT_VARIANT_ID) return candidate
  }
  return DEFAULT_VARIANT_ID
}

function getLandingDeviceType(): 'mobile' | 'desktop' | 'unknown' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'unknown'
  return window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop'
}

function getLandingReferrer(): string {
  if (typeof document === 'undefined' || !document.referrer) return 'direct'
  try {
    const hostname = new URL(document.referrer).hostname
    return hostname || 'direct'
  } catch {
    return 'direct'
  }
}

export function trackLandingView(variantId: string, locale: string): void {
  trackEvent('lp_view', {
    variant_id: variantId,
    locale,
    device_type: getLandingDeviceType(),
    referrer: getLandingReferrer(),
  })
}

export function trackHeroCtaClick(ctaLabel: string, variantId: string): void {
  trackEvent('lp_hero_cta_click', {
    cta_label: ctaLabel,
    variant_id: variantId,
    section: 'hero',
  })
}

export function trackSupportingCtaClick(ctaLabel: string, section: string): void {
  trackEvent('lp_supporting_cta_click', {
    cta_label: ctaLabel,
    section,
  })
}

export function trackPricingTeaserClick(ctaLabel: string, variantId: string): void {
  trackEvent('lp_pricing_teaser_click', {
    cta_label: ctaLabel,
    plan_hint: 'mixed',
    variant_id: variantId,
  })
}

export function trackFaqExpand(faqId: string, faqTopic: string): void {
  trackEvent('lp_faq_expand', {
    faq_id: faqId,
    faq_topic: faqTopic,
  })
}

export function trackSignupStart(sourceSection: string, ctaLabel: string, variantId: string): void {
  trackEvent('lp_signup_start', {
    source_section: sourceSection,
    cta_label: ctaLabel,
    variant_id: variantId,
  })
}
