/**
 * UpgradePrompt — global modal shown whenever a 402/403 quota error occurs.
 *
 * Wired to `useUpgradeStore`: any component or API call that triggers a
 * quota-exceeded error will automatically open this modal.
 */
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useUpgradeStore } from '../store/useUpgradeStore'
import { useCreateCheckout } from '../hooks/useBilling'
import { trackEvent } from '../lib/analytics'
import { ROUTES } from '../lib/routes'

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  library: 'Library',
}

const METRIC_LABELS: Record<string, string> = {
  scans: 'shelf scans',
  enrichments: 'metadata enrichments',
}

export function UpgradePrompt() {
  const { t } = useTranslation()
  const { isOpen, detail, hide } = useUpgradeStore()
  const checkoutMutation = useCreateCheckout()
  const navigate = useNavigate()

  if (!isOpen || !detail) return null

  const metricLabel = detail.metric ? (METRIC_LABELS[detail.metric] ?? detail.metric) : null
  const currentPlan = PLAN_LABELS[detail.plan] ?? detail.plan

  function handleUpgrade(plan: 'pro' | 'library') {
    trackEvent('upgrade_clicked', { plan, source: 'quota_prompt', metric: detail?.metric })
    checkoutMutation.mutate(plan)
    hide()
  }

  function handleSeePricing() {
    navigate(ROUTES.pricing)
    hide()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={hide}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          zIndex: 9000,
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Modal */}
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='upgrade-title'
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 9001,
          background: 'var(--sh-surface)',
          border: '1px solid var(--sh-border)',
          borderRadius: 'var(--sh-radius-lg)',
          boxShadow: 'var(--sh-shadow-lg)',
          padding: '28px 24px',
          width: 'min(480px, calc(100vw - 32px))',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--sh-primary)', opacity: 0.8 }}>
              {t('billing.limit_reached')}
            </p>
            <h2 id='upgrade-title' className='text-h2' style={{ margin: '4px 0 0' }}>
              {t('billing.upgrade_title')}
            </h2>
          </div>
          <button
            type='button'
            aria-label={t('common.close')}
            onClick={hide}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--sh-text-secondary)', padding: 4, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {metricLabel && detail.limit !== -1 && (
            <p className='text-small' style={{ margin: 0 }}>
              {t('billing.quota_message', {
                metric: metricLabel,
                used: detail.used ?? detail.limit,
                limit: detail.limit,
                plan: currentPlan,
              })}
            </p>
          )}
          {!metricLabel && (
            <p className='text-small' style={{ margin: 0 }}>
              {detail.code === 'library_limit_reached'
                ? t('billing.library_limit_message', { plan: currentPlan })
                : t('billing.member_limit_message', { plan: currentPlan })}
            </p>
          )}
          <p className='text-small' style={{ margin: 0, color: 'var(--sh-text-secondary)' }}>
            {t('billing.upgrade_cta')}
          </p>
        </div>

        {/* Plan options */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <PlanCard
            name='Pro'
            price='€4.99'
            features={['50 scans/month', 'Unlimited enrichments', '3 libraries', '3 members/library']}
            highlighted={detail.plan === 'free'}
            onSelect={() => handleUpgrade('pro')}
            loading={checkoutMutation.isPending}
          />
          <PlanCard
            name='Library'
            price='€14.99'
            features={['200 scans/month', 'Unlimited enrichments', '10 libraries', '15 members/library']}
            highlighted={detail.plan === 'pro'}
            onSelect={() => handleUpgrade('library')}
            loading={checkoutMutation.isPending}
          />
        </div>

        {/* Footer */}
        <button
          type='button'
          className='sh-btn-secondary'
          onClick={handleSeePricing}
          style={{ fontSize: 13 }}
        >
          {t('billing.see_all_plans')}
        </button>
      </div>
    </>
  )
}

interface PlanCardProps {
  name: string
  price: string
  features: string[]
  highlighted: boolean
  onSelect: () => void
  loading: boolean
}

function PlanCard({ name, price, features, highlighted, onSelect, loading }: PlanCardProps) {
  const { t } = useTranslation()
  return (
    <div
      style={{
        border: highlighted ? '2px solid var(--sh-primary)' : '1px solid var(--sh-border)',
        borderRadius: 'var(--sh-radius-lg)',
        padding: '14px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        position: 'relative',
      }}
    >
      {highlighted && (
        <span style={{
          position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--sh-primary)', color: 'white', fontSize: 10, fontWeight: 700,
          borderRadius: 'var(--sh-radius-pill)', padding: '2px 8px', whiteSpace: 'nowrap',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          {t('billing.recommended')}
        </span>
      )}
      <div>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{name}</p>
        <p style={{ margin: '2px 0 0', fontWeight: 600, color: 'var(--sh-primary)', fontSize: 17 }}>{price}<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--sh-text-secondary)' }}>/mo</span></p>
      </div>
      <ul style={{ margin: 0, padding: '0 0 0 14px', listStyle: 'disc', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {features.map((f) => (
          <li key={f} style={{ fontSize: 12, color: 'var(--sh-text-secondary)' }}>{f}</li>
        ))}
      </ul>
      <button
        type='button'
        className={highlighted ? 'sh-btn-primary' : 'sh-btn-secondary'}
        onClick={onSelect}
        disabled={loading}
        style={{ fontSize: 13, marginTop: 4 }}
      >
        {loading ? t('billing.redirecting') : t('billing.select_plan')}
      </button>
    </div>
  )
}
