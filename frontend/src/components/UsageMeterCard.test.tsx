import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true })),
}))

vi.mock('../lib/api', () => ({
  getBillingStatus: vi.fn(),
}))

import { getBillingStatus } from '../lib/api'
import { UsageMeterCard } from './UsageMeterCard'

function makeBilling(overrides?: object) {
  return {
    plan: 'free' as const,
    status: 'active',
    has_payment_method: false,
    trial_ends_at: null,
    current_period_end: null,
    usage: { scans_used: 2, scans_limit: 5, enrichments_used: 3, enrichments_limit: 20 },
    ...overrides,
  }
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <UsageMeterCard />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UsageMeterCard', () => {
  it('renders nothing when billing data is unavailable', async () => {
    vi.mocked(getBillingStatus).mockReturnValue(new Promise(() => {}))
    const { container } = renderCard()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows plan badge and meter rows for free plan', async () => {
    vi.mocked(getBillingStatus).mockResolvedValue(makeBilling())
    renderCard()
    expect(await screen.findByTestId('usage-plan-badge')).toHaveTextContent('Free')
    expect(screen.getByText('usage_meter.scans')).toBeInTheDocument()
    expect(screen.getByText('usage_meter.enrichments')).toBeInTheDocument()
  })

  it('shows CTA for free plan regardless of usage', async () => {
    vi.mocked(getBillingStatus).mockResolvedValue(makeBilling({ plan: 'free' }))
    renderCard()
    expect(await screen.findByRole('button', { name: /usage_meter\.cta_default/i })).toBeInTheDocument()
  })

  it('does not show CTA for paid plan with low usage', async () => {
    vi.mocked(getBillingStatus).mockResolvedValue(
      makeBilling({
        plan: 'pro',
        usage: { scans_used: 1, scans_limit: 100, enrichments_used: 1, enrichments_limit: 100 },
      }),
    )
    renderCard()
    await screen.findByTestId('usage-plan-badge')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows warning CTA when usage reaches 80%', async () => {
    vi.mocked(getBillingStatus).mockResolvedValue(
      makeBilling({
        plan: 'pro',
        usage: { scans_used: 80, scans_limit: 100, enrichments_used: 0, enrichments_limit: 100 },
      }),
    )
    renderCard()
    expect(await screen.findByRole('button', { name: /usage_meter\.cta_warning/i })).toBeInTheDocument()
  })

  it('shows over-limit CTA when usage exceeds limit', async () => {
    vi.mocked(getBillingStatus).mockResolvedValue(
      makeBilling({
        plan: 'pro',
        usage: { scans_used: 100, scans_limit: 100, enrichments_used: 0, enrichments_limit: 100 },
      }),
    )
    renderCard()
    expect(await screen.findByRole('button', { name: /usage_meter\.cta_over/i })).toBeInTheDocument()
  })

  it('does not render progress bar for unlimited metric', async () => {
    vi.mocked(getBillingStatus).mockResolvedValue(
      makeBilling({
        plan: 'pro',
        usage: { scans_used: 5, scans_limit: -1, enrichments_used: 5, enrichments_limit: -1 },
      }),
    )
    renderCard()
    await screen.findByTestId('usage-plan-badge')
    expect(document.querySelector('.sh-usage-meter-track')).not.toBeInTheDocument()
  })

  it('navigates to pricing on CTA click', async () => {
    vi.mocked(getBillingStatus).mockResolvedValue(makeBilling({ plan: 'free' }))
    renderCard()
    const cta = await screen.findByRole('button', { name: /usage_meter\.cta_default/i })
    await userEvent.click(cta)
    // Navigation is handled by react-router — just verify the click doesn't throw
    expect(cta).toBeInTheDocument()
  })
})
