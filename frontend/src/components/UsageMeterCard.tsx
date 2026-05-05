import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../contexts/AuthContext'
import { useBillingStatus } from '../hooks/useBilling'
import { ROUTES } from '../lib/routes'
import type { SubscriptionPlan, UsageSummary } from '../lib/types'

const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  free: 'Free',
  home: 'Home',
  pro: 'Pro',
  library: 'Library',
}

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.min(100, Math.round((used / limit) * 100))
}

function maxPct(usage: UsageSummary): number {
  return Math.max(
    pct(usage.scans_used, usage.scans_limit),
    pct(usage.enrichments_used, usage.enrichments_limit),
  )
}

interface MeterRowProps {
  label: string
  used: number
  limit: number
}

function MeterRow({ label, used, limit }: MeterRowProps) {
  const unlimited = limit === -1
  const fillPct = pct(used, limit)
  const isWarning = !unlimited && fillPct >= 80
  const isOver = !unlimited && used >= limit
  const barColor = isOver ? 'var(--sh-red)' : isWarning ? '#f59e0b' : 'var(--sh-primary)'

  return (
    <div className="sh-usage-meter-row">
      <div className="sh-usage-meter-labels">
        <span className="sh-usage-meter-label">{label}</span>
        <span
          className="sh-usage-meter-value"
          style={{ color: isOver ? 'var(--sh-red)' : undefined }}
        >
          {unlimited ? `${used} / ∞` : `${used} / ${limit}`}
        </span>
      </div>
      {!unlimited && (
        <div className="sh-usage-meter-track">
          <div
            className="sh-usage-meter-fill"
            style={{ width: `${fillPct}%`, background: barColor }}
          />
        </div>
      )}
    </div>
  )
}

export function UsageMeterCard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const { data: billing } = useBillingStatus({ enabled: isAuthenticated })

  if (!billing) return null

  const { plan, usage } = billing
  const mp = maxPct(usage)

  // CTA: always for free plan; for paid only when approaching / hitting a limit
  const showCta = plan === 'free' || mp >= 80
  const ctaLabel =
    mp >= 100
      ? t('usage_meter.cta_over')
      : mp >= 80
        ? t('usage_meter.cta_warning')
        : t('usage_meter.cta_default')
  const ctaIsUrgent = mp >= 80

  return (
    <div className="sh-usage-card" data-testid="usage-meter-card">
      <div className="sh-usage-card__header">
        <span className="sh-usage-plan-badge" data-testid="usage-plan-badge">
          {PLAN_LABELS[plan]}
        </span>
      </div>

      <MeterRow
        label={t('usage_meter.scans')}
        used={usage.scans_used}
        limit={usage.scans_limit}
      />
      <MeterRow
        label={t('usage_meter.enrichments')}
        used={usage.enrichments_used}
        limit={usage.enrichments_limit}
      />

      {showCta && (
        <button
          className={ctaIsUrgent ? 'sh-usage-cta sh-usage-cta--urgent' : 'sh-usage-cta'}
          onClick={() => navigate(ROUTES.pricing)}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  )
}
