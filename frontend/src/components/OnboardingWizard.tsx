import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Modal } from './Modal'
import { EmptyLibraryIcon, LocationPinIcon, CameraIcon } from './EmptyStateIcons'
import { useCompleteOnboarding, useSkipOnboarding } from '../hooks/useOnboarding'
import { ROUTES } from '../lib/routes'
import { trackEvent } from '../lib/analytics'

interface FirstBookOnboardingModalProps {
  open: boolean
  onDone: () => void
}

export function FirstBookOnboardingModal({ open, onDone }: FirstBookOnboardingModalProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const completeMutation = useCompleteOnboarding()
  const skipMutation = useSkipOnboarding()

  const handleAction = (action: string, route: string) => {
    completeMutation.mutate(undefined, {
      onSuccess: () => {
        localStorage.setItem('shelfy_onboarding_dismissed', '1')
        trackEvent('onboarding_action_selected', { action })
        navigate(route)
        onDone()
      },
    })
  }

  const handleSkip = () => {
    skipMutation.mutate(undefined, {
      onSuccess: () => {
        localStorage.setItem('shelfy_onboarding_dismissed', '1')
        trackEvent('onboarding_skipped')
        onDone()
      },
    })
  }

  const actions = [
    {
      key: 'scan',
      icon: <CameraIcon size={24} />,
      title: t('onboarding.action_scan_title'),
      desc: t('onboarding.action_scan_desc'),
      route: ROUTES.scanShelf,
      primary: true,
    },
    {
      key: 'manual',
      icon: <EmptyLibraryIcon size={24} />,
      title: t('onboarding.action_manual_title'),
      desc: t('onboarding.action_manual_desc'),
      route: ROUTES.addBook,
      primary: false,
    },
    {
      key: 'locations',
      icon: <LocationPinIcon size={24} />,
      title: t('onboarding.action_locations_title'),
      desc: t('onboarding.action_locations_desc'),
      route: ROUTES.locations,
      primary: false,
    },
  ]

  return (
    <Modal open={open} onClose={handleSkip} label={t('onboarding.title')} size="md">
      <div className="sh-onboarding-header">
        <h2 className="text-h2" style={{ marginTop: 0, marginBottom: 4 }}>
          {t('onboarding.title')}
        </h2>
        <p className="text-small" style={{ color: 'var(--sh-text-muted)', margin: 0 }}>
          {t('onboarding.subtitle')}
        </p>
      </div>

      <div className="sh-onboarding-picker">
        {actions.map(({ key, icon, title, desc, route, primary }) => (
          <button
            key={key}
            className={`sh-onboarding-action-card${primary ? ' sh-onboarding-action-card--primary' : ''}`}
            onClick={() => handleAction(key, route)}
            disabled={completeMutation.isPending}
          >
            <div className="sh-onboarding-action-icon" aria-hidden="true">
              {icon}
            </div>
            <div className="sh-onboarding-action-text">
              <span className="sh-onboarding-action-title">{title}</span>
              <span className="sh-onboarding-action-desc">{desc}</span>
            </div>
          </button>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginTop: 'var(--sh-space-4)' }}>
        <button
          className="sh-btn-ghost"
          onClick={handleSkip}
          disabled={skipMutation.isPending}
          style={{ fontSize: 13, color: 'var(--sh-text-muted)' }}
        >
          {t('onboarding.skip')}
        </button>
      </div>
    </Modal>
  )
}

// Keep old name so any other import sites continue to work
export { FirstBookOnboardingModal as OnboardingWizard }
