/**
 * Resolve where to send a user after a successful login or OAuth callback.
 *
 * Precedence (explicit on purpose — never guess):
 *   1. A pending checkout intent (user clicked "Sign in to continue" on
 *      the pricing page). We send them to ``/pricing``, where the page's
 *      resume effect consumes the intent and kicks off Stripe Checkout
 *      automatically.
 *   2. A ``state.from`` hint provided by ``ProtectedRoute`` or the
 *      pricing page. Used for regular deep-link auth gates.
 *   3. Fall back to the root, which in turn routes to ``/books`` or the
 *      landing page depending on auth status.
 *
 * We intentionally do NOT consume the intent here — the pricing page is
 * the single owner of the intent lifecycle, so it needs to read (and then
 * clear) the intent itself. That keeps exactly one place responsible for
 * consuming the handoff, which prevents double-fires under StrictMode or
 * a mid-navigation remount.
 */
import { readPendingCheckout } from './pending-checkout'
import { ROUTES } from './routes'

export interface PostLoginRouteState {
  from?: string
}

export function resolvePostLoginDestination(
  state: PostLoginRouteState | undefined,
): string {
  const pending = readPendingCheckout()
  if (pending) return ROUTES.pricing
  return state?.from ?? '/'
}
