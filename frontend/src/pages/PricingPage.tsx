import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../contexts/AuthContext'
import { useCreateCheckout, useBillingStatus } from '../hooks/useBilling'
import {
  consumePendingCheckout,
  savePendingCheckout,
} from '../lib/pending-checkout'
import { ROUTES } from '../lib/routes'
import type { BillingInterval, PaidPlan, SubscriptionPlan } from '../lib/types'

interface PlanDef {
  key: SubscriptionPlan
  nameKey: string
  /** CZK prices per interval — match the Stripe test-mode prices. */
  priceCzk: { monthly: number; yearly: number } | null
  featureKeys: string[]
  highlighted?: boolean
  checkoutPlan?: PaidPlan
}

/**
 * Pricing catalog — prices match `STRIPE_PRICE_ID_*_MONTHLY|YEARLY` in
 * `infra/.env.prod.local`. Yearly is shown as an effective per-month number
 * alongside the actual billed yearly total.
 */
const PLANS: PlanDef[] = [
  {
    key: 'free',
    nameKey: 'billing.plan_free',
    priceCzk: null,
    featureKeys: [
      'billing.feature_free_scans',
      'billing.feature_free_enrichments',
      'billing.feature_free_library',
      'billing.feature_free_members',
      'billing.feature_free_books',
      'billing.feature_pwa',
      'billing.feature_csv',
    ],
  },
  {
    key: 'home',
    nameKey: 'billing.plan_home',
    priceCzk: { monthly: 59, yearly: 590 },
    featureKeys: [
      'billing.feature_home_scans',
      'billing.feature_home_enrichments',
      'billing.feature_home_library',
      'billing.feature_home_members',
      'billing.feature_home_books',
      'billing.feature_includes_free',
    ],
    checkoutPlan: 'home',
  },
  {
    key: 'pro',
    nameKey: 'billing.plan_pro',
    priceCzk: { monthly: 129, yearly: 1290 },
    featureKeys: [
      'billing.feature_pro_scans',
      'billing.feature_pro_enrichments',
      'billing.feature_pro_libraries',
      'billing.feature_pro_members',
      'billing.feature_pro_books',
      'billing.feature_includes_home',
    ],
    highlighted: true,
    checkoutPlan: 'pro',
  },
  {
    key: 'library',
    nameKey: 'billing.plan_library',
    priceCzk: { monthly: 299, yearly: 2990 },
    featureKeys: [
      'billing.feature_library_scans',
      'billing.feature_library_enrichments',
      'billing.feature_library_libraries',
      'billing.feature_library_members',
      'billing.feature_library_books',
      'billing.feature_includes_pro',
      'billing.feature_priority_support',
    ],
    checkoutPlan: 'library',
  },
]

/**
 * Format a Czech-Koruna amount. We intentionally use `cs-CZ` locale regardless
 * of UI language — prices are billed in CZK, showing "129 Kč" everywhere is
 * clearer than translating to a symbol the user isn't charged in.
 */
function formatCzk(amount: number): string {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function PricingPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  // ── Auth truth comes from AuthContext only. ────────────────────────────────
  // Historical bug: we used to derive "authenticated" from the presence of a
  // ``useBillingStatus`` result. That fires an authenticated request from a
  // public page (visible 401, needless refresh round-trip) AND produces false
  // negatives during the query's loading window. ``useAuth()`` is the single
  // source of truth; billing status is only pulled once we KNOW we're logged
  // in, via the ``enabled`` flag below.
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const { data: billing } = useBillingStatus({ enabled: isAuthenticated })
  const checkoutMutation = useCreateCheckout()
  const [interval, setInterval] = useState<BillingInterval>('monthly')

  // ── Post-login resume ──────────────────────────────────────────────────────
  // When the user clicked "Sign in to continue" with a specific plan/interval
  // in mind we stashed an intent in sessionStorage (see pending-checkout.ts).
  // On the first render after they come back authenticated we consume it and
  // kick off the exact same checkout they asked for — no extra clicks needed.
  //
  // A ref guards against double-firing across re-renders (checkout triggers a
  // hard nav to Stripe on success, but StrictMode / concurrent-mode re-renders
  // can still fire the effect twice before navigation).
  const resumeAttempted = useRef(false)
  useEffect(() => {
    if (authLoading || !isAuthenticated || resumeAttempted.current) return
    const intent = consumePendingCheckout()
    if (!intent) return
    resumeAttempted.current = true
    // Reflect the user's saved interval on the UI in case the redirect
    // is slow / blocked — they shouldn't see "monthly" when they actually
    // asked for "yearly".
    setInterval(intent.interval)
    checkoutMutation.mutate({ plan: intent.plan, interval: intent.interval })
  }, [authLoading, isAuthenticated, checkoutMutation])

  const currentPlan = isAuthenticated ? (billing?.plan ?? null) : null

  function handleBack() {
    if (window.history.length > 1) navigate(-1)
    else navigate('/')
  }

  /**
   * Send a guest to login. If ``paidPlan`` is provided, we also stash a
   * checkout intent so login can auto-resume into Stripe Checkout. Guests
   * clicking the "Start free" button on the Free tier send no intent —
   * after login/register they just land on pricing (or home).
   */
  function handleGuestCta(paidPlan?: PaidPlan) {
    if (paidPlan) {
      savePendingCheckout({ plan: paidPlan, interval })
    }
    navigate(ROUTES.login, { state: { from: ROUTES.pricing } })
  }

  return (
    <section className='container md-max-w-3xl' style={{ margin: '0 auto', width: '100%' }}>
      <button
        type='button'
        className='sh-btn-secondary'
        onClick={handleBack}
        style={{ marginBottom: 12, fontSize: 13 }}
      >
        Zpět
      </button>
      <h2 className='text-h2'>{t('billing.pricing_title')}</h2>
      <p className='text-small' style={{ marginTop: 0, marginBottom: 16, color: 'var(--sh-text-secondary)' }}>
        {t('billing.pricing_subtitle')}
      </p>

      {/* Guest banner — makes the auth boundary explicit so a logged-out
          visitor never wonders whether they're already inside the app. */}
      {!authLoading && !isAuthenticated && (
        <div
          data-testid='pricing-guest-banner'
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '10px 14px',
            marginBottom: 16,
            background: 'var(--sh-teal-bg, var(--sh-surface))',
            border: '1px solid var(--sh-border)',
            borderRadius: 'var(--sh-radius-md, var(--sh-radius-lg))',
            fontSize: 13,
          }}
        >
          <span>{t('billing.guest_banner_text')}</span>
          <button
            type='button'
            className='sh-btn-secondary'
            data-testid='pricing-guest-login'
            onClick={() =>
              navigate(ROUTES.login, { state: { from: ROUTES.pricing } })
            }
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {t('billing.guest_banner_cta')}
          </button>
        </div>
      )}

      {/* Monthly / Yearly toggle */}
      <div
        role='tablist'
        aria-label={t('billing.interval_toggle_label')}
        style={{
          display: 'inline-flex',
          gap: 4,
          padding: 4,
          marginBottom: 20,
          background: 'var(--sh-surface-muted, var(--sh-border))',
          borderRadius: 'var(--sh-radius-pill)',
        }}
      >
        {(['monthly', 'yearly'] as const).map((opt) => {
          const active = interval === opt
          return (
            <button
              key={opt}
              type='button'
              role='tab'
              aria-selected={active}
              data-testid={`billing-interval-${opt}`}
              onClick={() => setInterval(opt)}
              className={active ? 'sh-btn-primary' : 'sh-btn-secondary'}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: '6px 14px',
                borderRadius: 'var(--sh-radius-pill)',
                border: active ? undefined : '1px solid transparent',
                background: active ? undefined : 'transparent',
              }}
            >
              {t(opt === 'monthly' ? 'billing.billed_monthly' : 'billing.billed_yearly')}
              {opt === 'yearly' && (
                <span style={{
                  marginLeft: 6, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: active ? 'white' : 'var(--sh-primary)',
                  opacity: 0.95,
                }}>
                  {t('billing.save_2_months')}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        {PLANS.map((plan) => {
          const isCurrent = currentPlan !== null && plan.key === currentPlan
          const isHighlighted = Boolean(plan.highlighted)
          const priceDisplay = plan.priceCzk
            ? interval === 'monthly'
              ? { amount: formatCzk(plan.priceCzk.monthly), note: t('billing.per_month') }
              : {
                  // Show "49 Kč / měsíc" (== 590/12 rounded) with footnote that we bill annually.
                  amount: formatCzk(Math.round(plan.priceCzk.yearly / 12)),
                  note: t('billing.per_month_billed_yearly', { total: formatCzk(plan.priceCzk.yearly) }),
                }
            : { amount: formatCzk(0), note: t('billing.forever') }

          return (
            <article
              key={plan.key}
              data-testid={`plan-card-${plan.key}`}
              style={{
                border: isHighlighted ? '2px solid var(--sh-primary)' : '1px solid var(--sh-border)',
                borderRadius: 'var(--sh-radius-lg)',
                padding: '20px 18px',
                background: 'var(--sh-surface)',
                boxShadow: isHighlighted ? 'var(--sh-shadow-lg)' : 'var(--sh-shadow-sm)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                position: 'relative',
              }}
            >
              {isHighlighted && (
                <span style={{
                  position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                  background: 'var(--sh-primary)', color: 'white', fontSize: 11, fontWeight: 700,
                  borderRadius: 'var(--sh-radius-pill)', padding: '3px 12px', whiteSpace: 'nowrap',
                  textTransform: 'uppercase', letterSpacing: '0.07em',
                }}>
                  {t('billing.most_popular')}
                </span>
              )}

              <div>
                <h3 className='text-h3' style={{ margin: 0 }}>{t(plan.nameKey)}</h3>
                <p style={{ margin: '6px 0 0', fontWeight: 700, fontSize: 24, color: 'var(--sh-primary)' }}>
                  {priceDisplay.amount}
                  <span style={{
                    display: 'block', fontSize: 12, fontWeight: 400,
                    color: 'var(--sh-text-secondary)', marginTop: 2,
                  }}>
                    {priceDisplay.note}
                  </span>
                </p>
              </div>

              <ul style={{ margin: 0, padding: '0 0 0 16px', listStyle: 'disc', flexGrow: 1 }}>
                {plan.featureKeys.map((fk) => (
                  <li key={fk} className='text-small' style={{ marginBottom: 4 }}>{t(fk)}</li>
                ))}
              </ul>

              {renderPlanCta({
                plan,
                isCurrent,
                isHighlighted,
                isAuthenticated,
                isAuthLoading: authLoading,
                isCheckoutPending: checkoutMutation.isPending,
                t,
                onGuestCta: handleGuestCta,
                onAuthedCheckout: (paidPlan) =>
                  checkoutMutation.mutate({ plan: paidPlan, interval }),
              })}
            </article>
          )
        })}
      </div>

      <p className='text-small' style={{ marginTop: 20, color: 'var(--sh-text-secondary)', textAlign: 'center' }}>
        {t('billing.pricing_footer')}
      </p>
    </section>
  )
}

// ── CTA helper ────────────────────────────────────────────────────────────────
// Pulled out so the rendering path for each of the four plan states is easy to
// read (and prove via tests) in isolation:
//   * Unknown auth (still bootstrapping) → disabled placeholder
//   * Guest on Free plan                 → "Start free" → /login
//   * Guest on paid plan                 → "Sign in to continue" → saves intent + /login
//   * Authed on their current plan       → "Current plan" (disabled)
//   * Authed on another paid plan        → "Get started" → Stripe checkout
interface PlanCtaProps {
  plan: PlanDef
  isCurrent: boolean
  isHighlighted: boolean
  isAuthenticated: boolean
  isAuthLoading: boolean
  isCheckoutPending: boolean
  t: (key: string) => string
  onGuestCta: (paidPlan?: PaidPlan) => void
  onAuthedCheckout: (plan: PaidPlan) => void
}

function renderPlanCta(props: PlanCtaProps) {
  const {
    plan, isCurrent, isHighlighted, isAuthenticated, isAuthLoading,
    isCheckoutPending, t, onGuestCta, onAuthedCheckout,
  } = props

  // While auth is bootstrapping we don't render a specific CTA yet. Showing
  // "Sign in to continue" for a flicker on a real logged-in user's screen is
  // jarring; a disabled placeholder is cleaner.
  if (isAuthLoading) {
    return (
      <button
        type='button'
        className='sh-btn-secondary'
        disabled
        aria-hidden='true'
        style={{ fontSize: 13, opacity: 0.5 }}
      >
        …
      </button>
    )
  }

  // Free tier: no paid checkout. Guests get "Start free" → register; authed
  // users on Free see "Current plan" (disabled). Authed + not current + Free
  // shouldn't happen (Free is everyone's fallback) so we render nothing
  // rather than a misleading button.
  if (!plan.checkoutPlan) {
    if (isCurrent) {
      return (
        <button type='button' className='sh-btn-secondary' disabled style={{ fontSize: 13 }}>
          {t('billing.current_plan')}
        </button>
      )
    }
    if (!isAuthenticated) {
      return (
        <button
          type='button'
          data-testid={`plan-checkout-${plan.key}`}
          className='sh-btn-secondary'
          // No pending-intent save — the free tier needs no Stripe checkout.
          // Route to /login with a ``from`` hint so the post-login redirect
          // lands back on pricing where they can continue from.
          onClick={() => onGuestCta(undefined)}
          style={{ fontSize: 13 }}
        >
          {t('billing.start_free')}
        </button>
      )
    }
    return null
  }

  // Paid tier:
  if (isCurrent) {
    return (
      <button type='button' className='sh-btn-secondary' disabled style={{ fontSize: 13 }}>
        {t('billing.current_plan')}
      </button>
    )
  }

  if (!isAuthenticated) {
    return (
      <button
        type='button'
        data-testid={`plan-checkout-${plan.key}`}
        className={isHighlighted ? 'sh-btn-primary' : 'sh-btn-secondary'}
        onClick={() => onGuestCta(plan.checkoutPlan!)}
        style={{ fontSize: 13 }}
      >
        {t('billing.sign_in_to_continue')}
      </button>
    )
  }

  return (
    <button
      type='button'
      data-testid={`plan-checkout-${plan.key}`}
      className={isHighlighted ? 'sh-btn-primary' : 'sh-btn-secondary'}
      onClick={() => onAuthedCheckout(plan.checkoutPlan!)}
      disabled={isCheckoutPending}
      style={{ fontSize: 13 }}
    >
      {isCheckoutPending ? t('billing.redirecting') : t('billing.get_started')}
    </button>
  )
}
