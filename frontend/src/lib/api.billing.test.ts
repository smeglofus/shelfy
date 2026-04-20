/**
 * Contract tests for the billing half of lib/api.ts.
 *
 * Guarantees the backend sees the `{ plan, interval }` shape it expects and
 * preserves the backward-compat path where a caller omits `interval` (backend
 * defaults to 'monthly').
 *
 * We mock `axios.create` so the module uses our stub instance — this avoids
 * real network calls and lets us assert exactly what was posted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const postSpy = vi.fn().mockResolvedValue({ data: { url: 'https://stripe.test/s' } })
const stubInstance = {
  post: postSpy,
  get: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
}

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => stubInstance),
    // AxiosError type is only imported as a type; runtime import is unused.
  },
}))

beforeEach(() => {
  postSpy.mockClear()
})

describe('createCheckoutSession', () => {
  it('POSTs { plan } when no interval is provided (back-compat)', async () => {
    const { createCheckoutSession } = await import('./api')
    await createCheckoutSession('pro')
    expect(postSpy).toHaveBeenCalledWith('/api/v1/billing/checkout', { plan: 'pro' })
  })

  it('POSTs { plan, interval } when monthly interval is provided', async () => {
    const { createCheckoutSession } = await import('./api')
    await createCheckoutSession('home', 'monthly')
    expect(postSpy).toHaveBeenCalledWith('/api/v1/billing/checkout', {
      plan: 'home',
      interval: 'monthly',
    })
  })

  it('POSTs { plan, interval } when yearly interval is provided', async () => {
    const { createCheckoutSession } = await import('./api')
    await createCheckoutSession('library', 'yearly')
    expect(postSpy).toHaveBeenCalledWith('/api/v1/billing/checkout', {
      plan: 'library',
      interval: 'yearly',
    })
  })
})
