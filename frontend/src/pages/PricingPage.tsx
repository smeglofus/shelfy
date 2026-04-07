import { useTranslation } from 'react-i18next'

import { useCreateCheckout } from '../hooks/useBilling'
import { useBillingStatus } from '../hooks/useBilling'

interface PlanDef {
  key: 'free' | 'pro' | 'library'
  name: string
  price: string
  priceNote: string
  features: string[]
  cta: 'current' | 'upgrade' | 'contact'
  checkoutPlan?: 'pro' | 'library'
}

const PLANS: PlanDef[] = [
  {
    key: 'free',
    name: 'Free',
    price: '€0',
    priceNote: 'forever',
    features: [
      '5 shelf scans / month',
      '20 metadata enrichments / month',
      '1 library',
      '1 member per library',
      'PWA — install on any device',
      'CSV export',
    ],
    cta: 'current',
  },
  {
    key: 'pro',
    name: 'Pro',
    price: '€4.99',
    priceNote: '/ month',
    features: [
      '50 shelf scans / month',
      'Unlimited metadata enrichments',
      '3 libraries',
      '3 members per library',
      'Everything in Free',
    ],
    cta: 'upgrade',
    checkoutPlan: 'pro',
  },
  {
    key: 'library',
    name: 'Library',
    price: '€14.99',
    priceNote: '/ month',
    features: [
      '200 shelf scans / month',
      'Unlimited metadata enrichments',
      '10 libraries',
      '15 members per library',
      'Everything in Pro',
      'Priority support',
    ],
    cta: 'upgrade',
    checkoutPlan: 'library',
  },
]

export function PricingPage() {
  const { t } = useTranslation()
  const { data: billing } = useBillingStatus()
  const checkoutMutation = useCreateCheckout()
  const currentPlan = billing?.plan ?? 'free'

  return (
    <section className='container md-max-w-3xl' style={{ margin: '0 auto', width: '100%' }}>
      <h2 className='text-h2'>{t('billing.pricing_title')}</h2>
      <p className='text-small' style={{ marginTop: 0, marginBottom: 24, color: 'var(--sh-text-secondary)' }}>
        {t('billing.pricing_subtitle')}
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        {PLANS.map((plan) => {
          const isCurrent = plan.key === currentPlan
          const isHighlighted = plan.key === 'pro'

          return (
            <article
              key={plan.key}
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
                <h3 className='text-h3' style={{ margin: 0 }}>{plan.name}</h3>
                <p style={{ margin: '6px 0 0', fontWeight: 700, fontSize: 24, color: 'var(--sh-primary)' }}>
                  {plan.price}
                  <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--sh-text-secondary)', marginLeft: 4 }}>
                    {plan.priceNote}
                  </span>
                </p>
              </div>

              <ul style={{ margin: 0, padding: '0 0 0 16px', listStyle: 'disc', flexGrow: 1 }}>
                {plan.features.map((f) => (
                  <li key={f} className='text-small' style={{ marginBottom: 4 }}>{f}</li>
                ))}
              </ul>

              {isCurrent ? (
                <button type='button' className='sh-btn-secondary' disabled style={{ fontSize: 13 }}>
                  {t('billing.current_plan')}
                </button>
              ) : plan.checkoutPlan ? (
                <button
                  type='button'
                  className={isHighlighted ? 'sh-btn-primary' : 'sh-btn-secondary'}
                  onClick={() => checkoutMutation.mutate(plan.checkoutPlan!)}
                  disabled={checkoutMutation.isPending}
                  style={{ fontSize: 13 }}
                >
                  {checkoutMutation.isPending ? t('billing.redirecting') : t('billing.get_started')}
                </button>
              ) : null}
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
