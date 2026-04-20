/**
 * pending-checkout tests.
 *
 * The intent module is the handoff between /pricing and /login and — via
 * the OAuth callback — Google. It ultimately feeds plan/interval into an
 * authenticated ``POST /billing/checkout``, so the contract we need to
 * prove is:
 *   * valid intents round-trip
 *   * malformed / stale entries are wiped, never returned
 *   * validation refuses to write garbage (defense in depth — the backend
 *     is also strict, but we don't want client code forging a bogus
 *     plan string and silently succeeding here)
 *   * consume() is read-once semantics (prevents auto-charge loops)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  _INTERNAL_STORAGE_KEY,
  _INTERNAL_TTL_MS,
  clearPendingCheckout,
  consumePendingCheckout,
  readPendingCheckout,
  savePendingCheckout,
} from './pending-checkout'

beforeEach(() => {
  window.sessionStorage.removeItem(_INTERNAL_STORAGE_KEY)
  vi.useRealTimers()
})

afterEach(() => {
  window.sessionStorage.removeItem(_INTERNAL_STORAGE_KEY)
  vi.useRealTimers()
})

describe('pending-checkout — happy path', () => {
  it('round-trips a valid intent through save/read', () => {
    savePendingCheckout({ plan: 'pro', interval: 'yearly' })

    const intent = readPendingCheckout()
    expect(intent).not.toBeNull()
    expect(intent?.plan).toBe('pro')
    expect(intent?.interval).toBe('yearly')
    expect(typeof intent?.createdAt).toBe('number')
  })

  it('consume() returns the intent and then clears it (read-once)', () => {
    savePendingCheckout({ plan: 'home', interval: 'monthly' })

    const first = consumePendingCheckout()
    expect(first?.plan).toBe('home')

    // Critical: auto-resume effect must not re-fire checkout on remount.
    expect(readPendingCheckout()).toBeNull()
    expect(consumePendingCheckout()).toBeNull()
  })

  it('clear() wipes an existing intent', () => {
    savePendingCheckout({ plan: 'library', interval: 'monthly' })
    clearPendingCheckout()
    expect(readPendingCheckout()).toBeNull()
  })
})

describe('pending-checkout — validation (refuses garbage on write)', () => {
  it('drops an unknown plan silently', () => {
    // @ts-expect-error — proving runtime guard even if TS is bypassed
    savePendingCheckout({ plan: 'enterprise', interval: 'monthly' })
    expect(readPendingCheckout()).toBeNull()
  })

  it('drops an unknown interval silently', () => {
    // @ts-expect-error — proving runtime guard even if TS is bypassed
    savePendingCheckout({ plan: 'pro', interval: 'lifetime' })
    expect(readPendingCheckout()).toBeNull()
  })

  it('refuses the "free" plan (intent is only for paid tiers)', () => {
    // @ts-expect-error — Free has no Stripe price, must never roundtrip
    savePendingCheckout({ plan: 'free', interval: 'monthly' })
    expect(readPendingCheckout()).toBeNull()
  })
})

describe('pending-checkout — TTL expiry', () => {
  it('returns null after the 10-minute TTL elapses', () => {
    vi.useFakeTimers()
    const t0 = new Date('2026-01-01T00:00:00Z').getTime()
    vi.setSystemTime(t0)

    savePendingCheckout({ plan: 'pro', interval: 'yearly' })
    expect(readPendingCheckout()).not.toBeNull()

    // Just before TTL — still valid.
    vi.setSystemTime(t0 + _INTERNAL_TTL_MS - 1000)
    expect(readPendingCheckout()).not.toBeNull()

    // One millisecond past TTL — gone.
    vi.setSystemTime(t0 + _INTERNAL_TTL_MS + 1)
    expect(readPendingCheckout()).toBeNull()
  })

  it('wipes the stale entry as a side effect of reading', () => {
    vi.useFakeTimers()
    const t0 = new Date('2026-01-01T00:00:00Z').getTime()
    vi.setSystemTime(t0)
    savePendingCheckout({ plan: 'home', interval: 'monthly' })

    vi.setSystemTime(t0 + _INTERNAL_TTL_MS + 60_000)
    readPendingCheckout() // triggers cleanup

    // Revert time — the old stale entry should have been removed, not
    // still sitting in storage waiting to mysteriously "come back".
    vi.setSystemTime(t0)
    expect(window.sessionStorage.getItem(_INTERNAL_STORAGE_KEY)).toBeNull()
  })
})

describe('pending-checkout — corrupt storage hygiene', () => {
  it('wipes a malformed-JSON entry and returns null', () => {
    window.sessionStorage.setItem(_INTERNAL_STORAGE_KEY, '{not valid json')
    expect(readPendingCheckout()).toBeNull()
    expect(window.sessionStorage.getItem(_INTERNAL_STORAGE_KEY)).toBeNull()
  })

  it('wipes an entry whose shape does not match', () => {
    window.sessionStorage.setItem(
      _INTERNAL_STORAGE_KEY,
      JSON.stringify({ plan: 'pro' }), // missing interval + createdAt
    )
    expect(readPendingCheckout()).toBeNull()
    expect(window.sessionStorage.getItem(_INTERNAL_STORAGE_KEY)).toBeNull()
  })

  it('wipes an entry whose plan is not in the allow-list', () => {
    window.sessionStorage.setItem(
      _INTERNAL_STORAGE_KEY,
      JSON.stringify({ plan: 'hacker', interval: 'monthly', createdAt: Date.now() }),
    )
    expect(readPendingCheckout()).toBeNull()
    expect(window.sessionStorage.getItem(_INTERNAL_STORAGE_KEY)).toBeNull()
  })

  it('wipes an entry whose createdAt is not a number', () => {
    window.sessionStorage.setItem(
      _INTERNAL_STORAGE_KEY,
      JSON.stringify({ plan: 'pro', interval: 'yearly', createdAt: 'yesterday' }),
    )
    expect(readPendingCheckout()).toBeNull()
    expect(window.sessionStorage.getItem(_INTERNAL_STORAGE_KEY)).toBeNull()
  })
})
