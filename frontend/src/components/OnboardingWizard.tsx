import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Modal } from './Modal'
import { EmptyLibraryIcon, LocationPinIcon, CameraIcon } from './EmptyStateIcons'
import { useCompleteOnboarding, useSkipOnboarding } from '../hooks/useOnboarding'
import { ROUTES } from '../lib/routes'

interface OnboardingWizardProps {
  open: boolean
  onDone: () => void
}

const TOTAL_STEPS = 3

export function OnboardingWizard({ open, onDone }: OnboardingWizardProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [step, setStep] = useState(0) // 0-2 = steps, 3 = success
  const completeMutation = useCompleteOnboarding()
  const skipMutation = useSkipOnboarding()

  const handleSkipAll = () => {
    skipMutation.mutate(undefined, {
      onSuccess: () => {
        localStorage.setItem('shelfy_onboarding_dismissed', '1')
        onDone()
      },
    })
  }

  const handleFinish = () => {
    completeMutation.mutate(undefined, {
      onSuccess: () => {
        localStorage.setItem('shelfy_onboarding_dismissed', '1')
        onDone()
      },
    })
  }

  const handleStepCta = () => {
    // Navigate to the relevant page and close wizard
    completeMutation.mutate(undefined, {
      onSuccess: () => {
        localStorage.setItem('shelfy_onboarding_dismissed', '1')
        if (step === 0) navigate(ROUTES.addBook)
        else if (step === 1) navigate(ROUTES.locations)
        else if (step === 2) navigate(ROUTES.scanShelf)
        onDone()
      },
    })
  }

  const handleNext = () => {
    if (step < TOTAL_STEPS - 1) {
      setStep((s) => s + 1)
    } else {
      // Last step → success screen
      setStep(TOTAL_STEPS)
    }
  }

  const handleBack = () => {
    if (step > 0) setStep((s) => s - 1)
  }

  const steps = [
    {
      icon: <EmptyLibraryIcon size={32} />,
      title: t('onboarding.step1_title'),
      desc: t('onboarding.step1_desc'),
      cta: t('onboarding.step1_cta'),
    },
    {
      icon: <LocationPinIcon size={32} />,
      title: t('onboarding.step2_title'),
      desc: t('onboarding.step2_desc'),
      cta: t('onboarding.step2_cta'),
    },
    {
      icon: <CameraIcon size={32} />,
      title: t('onboarding.step3_title'),
      desc: t('onboarding.step3_desc'),
      cta: t('onboarding.step3_cta'),
    },
  ]

  const isSuccess = step === TOTAL_STEPS

  return (
    <Modal open={open} onClose={handleSkipAll} label={t('onboarding.title')} size="md">
      {/* Header */}
      <div className="sh-onboarding-header">
        <h2 className="text-h2" style={{ marginTop: 0, marginBottom: 4 }}>
          {t('onboarding.title')}
        </h2>
        <p className="text-small" style={{ color: 'var(--sh-text-muted)', margin: 0 }}>
          {t('onboarding.subtitle')}
        </p>
      </div>

      {/* Stepper dots */}
      {!isSuccess && (
        <div className="sh-onboarding-stepper">
          {steps.map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sh-space-2)' }}>
              <div
                className={`sh-onboarding-dot${
                  i === step ? ' sh-onboarding-dot--active' : i < step ? ' sh-onboarding-dot--done' : ''
                }`}
              />
              {i < steps.length - 1 && (
                <div
                  className={`sh-onboarding-connector${i < step ? ' sh-onboarding-connector--done' : ''}`}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Step content or success */}
      {isSuccess ? (
        <div className="sh-onboarding-success">
          <div className="sh-onboarding-checkmark" aria-hidden="true">
            ✓
          </div>
          <h3 className="text-h3" style={{ margin: 0 }}>{t('onboarding.success_title')}</h3>
          <p className="text-p" style={{ margin: 0, color: 'var(--sh-text-muted)' }}>
            {t('onboarding.success_desc')}
          </p>
          <button className="sh-btn-primary" onClick={handleFinish} style={{ marginTop: 8 }}>
            {t('onboarding.success_cta')}
          </button>
        </div>
      ) : (
        <>
          {/* Current step */}
          <div className="sh-onboarding-step" key={step}>
            <div className="sh-onboarding-icon" aria-hidden="true">
              {steps[step].icon}
            </div>
            <div>
              <p className="text-small" style={{ color: 'var(--sh-text-muted)', margin: '0 0 4px' }}>
                {t('onboarding.step_of', { current: step + 1, total: TOTAL_STEPS })}
              </p>
              <h3 className="text-h3" style={{ margin: '0 0 8px' }}>{steps[step].title}</h3>
              <p className="text-p" style={{ margin: 0, color: 'var(--sh-text-muted)' }}>
                {steps[step].desc}
              </p>
            </div>
            <button className="sh-btn-primary" onClick={handleStepCta}>
              {steps[step].cta}
            </button>
          </div>

          {/* Actions */}
          <div className="sh-onboarding-actions">
            <button
              className="sh-btn-secondary"
              onClick={handleSkipAll}
              disabled={skipMutation.isPending}
              style={{ fontSize: 13 }}
            >
              {t('onboarding.skip_all')}
            </button>

            <div style={{ display: 'flex', gap: 'var(--sh-space-2)' }}>
              {step > 0 && (
                <button className="sh-btn-secondary" onClick={handleBack}>
                  {t('onboarding.back')}
                </button>
              )}
              <button className="sh-btn-secondary" onClick={handleNext}>
                {step < TOTAL_STEPS - 1 ? t('onboarding.next') : t('onboarding.finish')}
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}
