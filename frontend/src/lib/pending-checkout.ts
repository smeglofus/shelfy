/**
 * Pending-checkout intent — the "I wanted to buy X before I logged in"
 * handoff between ``/pricing`` and ``/login`` (and the OAuth callback).
 *
 * Stored in ``sessionStorage`` rather than React state so the intent
 * survives:
 *   * a full-page redirect through Google OAuth
 *   * a direct ``window.location.href = '/login'`` navigation
 *   * a refresh on the login page
 *
 * Scoped to a single tab (sessionStorage, not localStorage) because the
 * intent represents a specific user action in this tab; a second tab must
 * not inherit it.
 *
 * TTL of 10 minutes so an intent that never got consumed (user closed
 * login mid-flow and came back later) doesn't surprise-charge anyone: it
 * silently expires and the user sees pricing as a regular authenticated
 * visit.
 *
 * This module is the ONLY source of truth for the intent. Never read/
 * write the raw key directly from components — it keeps the storage
 * contract changeable from here (e.g. a future schema bump would live
 * in ``_STORAGE_KEY``).
 */
import type { BillingInterval, PaidPlan } from './types'

const _STORAGE_KEY = 'shelfy.pending_checkout_intent_v1'
const _TTL_MS = 10 * 60 * 1000 // 10 minutes

const _VALID_PLANS: readonly PaidPlan[] = ['home', 'pro', 'library']
const _VALID_INTERVALS: readonly BillingInterval[] = ['monthly', 'yearly']

export interface PendingCheckoutIntent {
  plan: PaidPlan
  interval: BillingInterval
  /** Unix ms when the intent was recorded. Used for TTL enforcement. */
  createdAt: number
}

/** Input shape when creating an intent — ``createdAt`` is filled here. */
export type PendingCheckoutInput = Omit<PendingCheckoutIntent, 'createdAt'>

function _storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    // Storage access can throw in privacy modes / sandboxed iframes.
    return null
  }
}

/** Persist an intent. Silently no-ops when sessionStorage is unavailable. */
export function savePendingCheckout(input: PendingCheckoutInput): void {
  const store = _storage()
  if (!store) return

  // Defensive validation — refuse to write garbage, since we'll ultimately
  // feed plan/interval into an authenticated POST /api/v1/billing/checkout.
  if (!_VALID_PLANS.includes(input.plan)) return
  if (!_VALID_INTERVALS.includes(input.interval)) return

  const intent: PendingCheckoutIntent = {
    plan: input.plan,
    interval: input.interval,
    createdAt: Date.now(),
  }

  try {
    store.setItem(_STORAGE_KEY, JSON.stringify(intent))
  } catch {
    // QuotaExceeded, etc. — intent simply won't be preserved, which is
    // the same UX as "no intent" (user lands on pricing after login).
  }
}

/**
 * Return the currently stored intent, if any — but only if it is still
 * within TTL and passes shape validation. Stale / malformed entries are
 * wiped as a side effect so the caller never has to worry about them.
 */
export function readPendingCheckout(): PendingCheckoutIntent | null {
  const store = _storage()
  if (!store) return null

  let raw: string | null
  try {
    raw = store.getItem(_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    clearPendingCheckout()
    return null
  }

  if (!parsed || typeof parsed !== 'object') {
    clearPendingCheckout()
    return null
  }

  const candidate = parsed as Record<string, unknown>
  const plan = candidate.plan
  const interval = candidate.interval
  const createdAt = candidate.createdAt

  if (
    typeof plan !== 'string' ||
    !_VALID_PLANS.includes(plan as PaidPlan) ||
    typeof interval !== 'string' ||
    !_VALID_INTERVALS.includes(interval as BillingInterval) ||
    typeof createdAt !== 'number' ||
    Number.isNaN(createdAt)
  ) {
    clearPendingCheckout()
    return null
  }

  if (Date.now() - createdAt > _TTL_MS) {
    clearPendingCheckout()
    return null
  }

  return {
    plan: plan as PaidPlan,
    interval: interval as BillingInterval,
    createdAt,
  }
}

/**
 * Read-and-consume: returns the intent (if fresh) and wipes it in one
 * atomic step. This is the normal code path after a successful login —
 * you get the intent exactly once and subsequent reads return ``null``.
 */
export function consumePendingCheckout(): PendingCheckoutIntent | null {
  const intent = readPendingCheckout()
  if (intent) clearPendingCheckout()
  return intent
}

export function clearPendingCheckout(): void {
  const store = _storage()
  if (!store) return
  try {
    store.removeItem(_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Exposed for tests only — never read in product code. */
export const _INTERNAL_STORAGE_KEY = _STORAGE_KEY
export const _INTERNAL_TTL_MS = _TTL_MS
