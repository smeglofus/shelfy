import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OnboardingWizard } from './OnboardingWizard'

vi.mock('../lib/api', () => ({
  getOnboardingStatus: vi.fn(),
  completeOnboarding: vi.fn(),
  skipOnboarding: vi.fn(),
  resetOnboarding: vi.fn(),
}))

import { completeOnboarding, skipOnboarding } from '../lib/api'

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

describe('OnboardingWizard', () => {
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
    renderWithProviders(<OnboardingWizard open={false} onDone={onDone} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders step 1 when open', () => {
    renderWithProviders(<OnboardingWizard open={true} onDone={onDone} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('onboarding.step1_title')).toBeInTheDocument()
  })

  it('navigates between steps with next/back', async () => {
    renderWithProviders(<OnboardingWizard open={true} onDone={onDone} />)

    // Step 1
    expect(screen.getByText('onboarding.step1_title')).toBeInTheDocument()

    // Go to step 2
    await userEvent.click(screen.getByRole('button', { name: 'onboarding.next' }))
    expect(screen.getByText('onboarding.step2_title')).toBeInTheDocument()

    // Go back to step 1
    await userEvent.click(screen.getByRole('button', { name: 'onboarding.back' }))
    expect(screen.getByText('onboarding.step1_title')).toBeInTheDocument()
  })

  it('shows success screen after last step', async () => {
    renderWithProviders(<OnboardingWizard open={true} onDone={onDone} />)

    // Navigate to step 3
    await userEvent.click(screen.getByRole('button', { name: 'onboarding.next' }))
    await userEvent.click(screen.getByRole('button', { name: 'onboarding.next' }))

    // Step 3 should show "finish" button
    expect(screen.getByText('onboarding.step3_title')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'onboarding.finish' }))

    // Success screen
    expect(screen.getByText('onboarding.success_title')).toBeInTheDocument()
  })

  it('calls skip mutation and onDone on skip all', async () => {
    renderWithProviders(<OnboardingWizard open={true} onDone={onDone} />)

    await userEvent.click(screen.getByRole('button', { name: 'onboarding.skip_all' }))

    await waitFor(() => {
      expect(skipOnboarding).toHaveBeenCalledTimes(1)
      expect(onDone).toHaveBeenCalledTimes(1)
    })

    expect(localStorage.getItem('shelfy_onboarding_dismissed')).toBe('1')
  })

  it('calls complete mutation on step CTA click', async () => {
    renderWithProviders(<OnboardingWizard open={true} onDone={onDone} />)

    // Click CTA on step 1
    await userEvent.click(screen.getByRole('button', { name: 'onboarding.step1_cta' }))

    await waitFor(() => {
      expect(completeOnboarding).toHaveBeenCalledTimes(1)
      expect(onDone).toHaveBeenCalledTimes(1)
    })

    expect(localStorage.getItem('shelfy_onboarding_dismissed')).toBe('1')
  })
})
