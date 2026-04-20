/**
 * PricingPage tests.
 *
 * Coverage:
 *  - Unauthenticated visitors (the newly public pricing flow)
 *     * All four tiers render
 *     * No authenticated API call is fired (no /billing/status GET)
 *     * "Sign in to continue" CTAs persist the checkout intent and
 *       navigate to /login with ``state.from = '/pricing'``
 *     * The interval toggle feeds the saved intent (monthly vs yearly)
 *     * A guest banner is visible so the page never feels
 *       "pseudo-logged-in"
 *     * No checkout network call is made (the guest can't start checkout
 *       directly, per the non-negotiable outcome)
 *  - Authenticated visitors
 *     * /billing/status IS fetched (the enabled flag flips)
 *     * The current plan card is disabled
 *     * Checkout mutation is fired for other tiers with the correct
 *       { plan, interval } payload
 *     * On mount with a pending intent, checkout auto-resumes exactly
 *       once (the post-login flow)
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────────

// IMPORTANT: the current mode is mutated by individual tests via
// ``setAuthState`` below. The mock has to read from the outer-scoped
// variable at call time, not capture-by-value.
let _authState: {
  isAuthenticated: boolean
  isLoading: boolean
  user: unknown
} = { isAuthenticated: false, isLoading: false, user: null }

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => _authState),
}))

vi.mock('../lib/api', () => ({
  getBillingStatus: vi.fn(() =>
    Promise.resolve({
      plan: 'free',
      status: 'active',
      has_payment_method: false,
      trial_ends_at: null,
      current_period_end: null,
      usage: { scans_used: 0, scans_limit: 5, enrichments_used: 0, enrichments_limit: 20 },
    }),
  ),
  createCheckoutSession: vi.fn(() => Promise.resolve({ url: 'https://stripe.test/session' })),
  createPortalSession: vi.fn(),
}))

import { createCheckoutSession, getBillingStatus } from '../lib/api'
import {
  _INTERNAL_STORAGE_KEY,
  readPendingCheckout,
  savePendingCheckout,
} from '../lib/pending-checkout'

// Need a navigate() spy that both lets the tests assert on it AND preserves
// the rest of react-router-dom. We do this by re-exporting everything real
// and overriding ``useNavigate`` to return our spy.
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

import { PricingPage } from './PricingPage'

// ── Harness ────────────────────────────────────────────────────────────────

function setAuthState(
  next: Partial<{ isAuthenticated: boolean; isLoading: boolean; user: unknown }>,
): void {
  _authState = { ..._authState, ...next }
}

// jsdom's ``window.location`` is read-only for modern Vitest; instead of
// replacing it, we stub ``Object.defineProperty`` only for the href setter.
// Simpler: intercept via a getter/setter on the property descriptor so the
// checkout-success navigation can't actually redirect jsdom.
let _hrefValue = ''
beforeEach(() => {
  _hrefValue = ''
  const locationProxy = new Proxy(window.location, {
    set(target, prop, value) {
      if (prop === 'href') {
        _hrefValue = value
        return true
      }
      // @ts-expect-error — delegate everything else to the real location
      target[prop] = value
      return true
    },
    get(target, prop) {
      if (prop === 'href') return _hrefValue
      // @ts-expect-error — delegate reads to the real location
      return target[prop]
    },
  })
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: locationProxy,
  })

  // Reset cross-test state.
  window.sessionStorage.removeItem(_INTERNAL_STORAGE_KEY)
  vi.mocked(createCheckoutSession).mockClear()
  vi.mocked(getBillingStatus).mockClear()
  mockNavigate.mockClear()
  setAuthState({ isAuthenticated: false, isLoading: false, user: null })
})

afterEach(() => {
  cleanup()
  window.sessionStorage.removeItem(_INTERNAL_STORAGE_KEY)
})

function renderPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pricing']}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  render(<PricingPage />, { wrapper })
}

// ── Unauthenticated (public) mode ─────────────────────────────────────────

describe('PricingPage — unauthenticated visitor', () => {
  it('renders all four plan tiers without firing /billing/status', async () => {
    setAuthState({ isAuthenticated: false, isLoading: false })
    renderPage()

    expect(await screen.findByTestId('plan-card-free')).toBeInTheDocument()
    expect(screen.getByTestId('plan-card-home')).toBeInTheDocument()
    expect(screen.getByTestId('plan-card-pro')).toBeInTheDocument()
    expect(screen.getByTestId('plan-card-library')).toBeInTheDocument()

    // Non-negotiable outcome: logged-out users browse without the app
    // pretending they're signed in. Concretely that means we do NOT fire
    // authenticated API calls (otherwise the network tab fills with 401s
    // and the refresh interceptor thrashes).
    expect(getBillingStatus).not.toHaveBeenCalled()
  })

  it('shows a guest banner (no pseudo-logged-in state)', async () => {
    setAuthState({ isAuthenticated: false, isLoading: false })
    renderPage()

    expect(await screen.findByTestId('pricing-guest-banner')).toBeInTheDocument()
  })

  it('does NOT start Stripe checkout when a guest clicks a paid plan', async () => {
    setAuthState({ isAuthenticated: false, isLoading: false })
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByTestId('plan-checkout-pro'))

    // Intent preserved, but zero direct checkout. Guest cannot bypass auth.
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  it('persists a monthly checkout intent and routes to /login', async () => {
    setAuthState({ isAuthenticated: false, isLoading: false })
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByTestId('plan-checkout-pro'))

    const intent = readPendingCheckout()
    expect(intent).toEqual(
      expect.objectContaining({ plan: 'pro', interval: 'monthly' }),
    )
    expect(mockNavigate).toHaveBeenCalledWith(
      '/login',
      expect.objectContaining({ state: expect.objectContaining({ from: '/pricing' }) }),
    )
  })

  it('persists a yearly intent when the yearly toggle is active', async () => {
    setAuthState({ isAuthenticated: false, isLoading: false })
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByTestId('billing-interval-yearly'))
    await user.click(await screen.findByTestId('plan-checkout-library'))

    const intent = readPendingCheckout()
    expect(intent).toEqual(
      expect.objectContaining({ plan: 'library', interval: 'yearly' }),
    )
  })

  it('free-tier CTA routes to /login WITHOUT saving a checkout intent', async () => {
    setAuthState({ isAuthenticated: false, isLoading: false })
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByTestId('plan-checkout-free'))

    expect(mockNavigate).toHaveBeenCalledWith(
      '/login',
      expect.objectContaining({ state: expect.objectContaining({ from: '/pricing' }) }),
    )
    // No paid-plan intent saved — Free doesn't need Stripe checkout.
    expect(readPendingCheckout()).toBeNull()
  })

  it('guest-banner button routes to /login with ?from hint', async () => {
    setAuthState({ isAuthenticated: false, isLoading: false })
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByTestId('pricing-guest-login'))

    expect(mockNavigate).toHaveBeenCalledWith(
      '/login',
      expect.objectContaining({ state: expect.objectContaining({ from: '/pricing' }) }),
    )
  })
})

// ── Authenticated mode ────────────────────────────────────────────────────

describe('PricingPage — authenticated visitor', () => {
  it('fetches /billing/status (enabled flips when auth flips)', async () => {
    setAuthState({ isAuthenticated: true, isLoading: false })
    renderPage()

    await waitFor(() => expect(getBillingStatus).toHaveBeenCalled())
  })

  it('keeps the current plan disabled (no checkout button for "free")', async () => {
    setAuthState({ isAuthenticated: true, isLoading: false })
    renderPage()

    await screen.findByTestId('plan-card-free')
    await waitFor(() => expect(getBillingStatus).toHaveBeenCalled())
    expect(screen.queryByTestId('plan-checkout-free')).not.toBeInTheDocument()
  })

  it('sends { plan, interval: "monthly" } on paid-plan click', async () => {
    setAuthState({ isAuthenticated: true, isLoading: false })
    renderPage()

    const user = userEvent.setup()
    const homeButton = await screen.findByTestId('plan-checkout-home')
    await user.click(homeButton)

    expect(createCheckoutSession).toHaveBeenCalledTimes(1)
    expect(createCheckoutSession).toHaveBeenCalledWith('home', 'monthly')
  })

  it('forwards the yearly interval on toggle', async () => {
    setAuthState({ isAuthenticated: true, isLoading: false })
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByTestId('billing-interval-yearly'))
    await user.click(await screen.findByTestId('plan-checkout-pro'))

    expect(createCheckoutSession).toHaveBeenCalledTimes(1)
    expect(createCheckoutSession).toHaveBeenCalledWith('pro', 'yearly')
  })

  it('does NOT show the guest banner when authenticated', async () => {
    setAuthState({ isAuthenticated: true, isLoading: false })
    renderPage()

    await screen.findByTestId('plan-card-free')
    expect(screen.queryByTestId('pricing-guest-banner')).not.toBeInTheDocument()
  })
})

// ── Post-login resume (intent round-trip) ─────────────────────────────────

describe('PricingPage — post-login checkout resume', () => {
  it('auto-resumes checkout with the saved plan + interval', async () => {
    // Stash an intent as if the user came back from /login after clicking
    // "Sign in to continue" on the Pro-yearly card.
    savePendingCheckout({ plan: 'pro', interval: 'yearly' })
    setAuthState({ isAuthenticated: true, isLoading: false })
    renderPage()

    await waitFor(() =>
      expect(createCheckoutSession).toHaveBeenCalledWith('pro', 'yearly'),
    )
    // Intent is consumed — a reload / re-mount must not re-fire.
    expect(readPendingCheckout()).toBeNull()
  })

  it('does NOT auto-resume while auth is still bootstrapping', async () => {
    savePendingCheckout({ plan: 'home', interval: 'monthly' })
    // ``isLoading`` simulates the first render before /auth/me resolves.
    setAuthState({ isAuthenticated: false, isLoading: true })
    renderPage()

    // Give React a tick; the effect must gate on !isLoading.
    await new Promise((r) => setTimeout(r, 20))
    expect(createCheckoutSession).not.toHaveBeenCalled()
    // Intent NOT consumed — still available once auth resolves.
    expect(readPendingCheckout()).not.toBeNull()
  })

  it('does NOT resume for unauthenticated visitors even if an intent leaked in', async () => {
    savePendingCheckout({ plan: 'library', interval: 'monthly' })
    setAuthState({ isAuthenticated: false, isLoading: false })
    renderPage()

    await screen.findByTestId('plan-card-library')
    expect(createCheckoutSession).not.toHaveBeenCalled()
    // The guest still owns the intent — it wasn't consumed behind their back.
    expect(readPendingCheckout()).not.toBeNull()
  })
})
