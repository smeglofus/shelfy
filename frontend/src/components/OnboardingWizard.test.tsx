import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FirstBookOnboardingModal } from './OnboardingWizard'

vi.mock('../lib/api', () => ({
  getOnboardingStatus: vi.fn(),
  completeOnboarding: vi.fn(),
  skipOnboarding: vi.fn(),
  resetOnboarding: vi.fn(),
}))

vi.mock('../lib/analytics', () => ({
  trackEvent: vi.fn(),
}))

import { completeOnboarding, skipOnboarding } from '../lib/api'
import { trackEvent } from '../lib/analytics'

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('FirstBookOnboardingModal', () => {
  const onDone = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(completeOnboarding).mockResolvedValue({ should_show: false, completed_at: '2024-01-01T00:00:00Z', skipped_at: null })
    vi.mocked(skipOnboarding).mockResolvedValue({ should_show: false, completed_at: null, skipped_at: '2024-01-01T00:00:00Z' })
  })

  afterEach(() => {
    cleanup()
  })

  it('does not render when open=false', () => {
    renderWithProviders(<FirstBookOnboardingModal open={false} onDone={onDone} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders action picker when open', () => {
    renderWithProviders(<FirstBookOnboardingModal open={true} onDone={onDone} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('onboarding.title')).toBeInTheDocument()
    expect(screen.getByText('onboarding.action_scan_title')).toBeInTheDocument()
    expect(screen.getByText('onboarding.action_manual_title')).toBeInTheDocument()
    expect(screen.getByText('onboarding.action_locations_title')).toBeInTheDocument()
  })

  it('calls skip mutation and onDone on skip click', async () => {
    renderWithProviders(<FirstBookOnboardingModal open={true} onDone={onDone} />)

    await userEvent.click(screen.getByRole('button', { name: 'onboarding.skip' }))

    await waitFor(() => {
      expect(skipOnboarding).toHaveBeenCalledTimes(1)
      expect(onDone).toHaveBeenCalledTimes(1)
    })

    expect(localStorage.getItem('shelfy_onboarding_dismissed')).toBe('1')
    expect(trackEvent).toHaveBeenCalledWith('onboarding_skipped')
  })

  it('calls complete mutation and tracks event when scan action chosen', async () => {
    renderWithProviders(<FirstBookOnboardingModal open={true} onDone={onDone} />)

    await userEvent.click(screen.getByText('onboarding.action_scan_title'))

    await waitFor(() => {
      expect(completeOnboarding).toHaveBeenCalledTimes(1)
      expect(onDone).toHaveBeenCalledTimes(1)
    })

    expect(localStorage.getItem('shelfy_onboarding_dismissed')).toBe('1')
    expect(trackEvent).toHaveBeenCalledWith('onboarding_action_selected', { action: 'scan' })
  })

  it('calls complete mutation and tracks event when add book action chosen', async () => {
    renderWithProviders(<FirstBookOnboardingModal open={true} onDone={onDone} />)

    await userEvent.click(screen.getByText('onboarding.action_manual_title'))

    await waitFor(() => {
      expect(completeOnboarding).toHaveBeenCalledTimes(1)
      expect(onDone).toHaveBeenCalledTimes(1)
    })

    expect(localStorage.getItem('shelfy_onboarding_dismissed')).toBe('1')
    expect(trackEvent).toHaveBeenCalledWith('onboarding_action_selected', { action: 'manual' })
  })
})
