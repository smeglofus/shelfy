import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createCheckoutSession, createPortalSession, getBillingStatus } from '../lib/api'
import type { BillingInterval, PaidPlan } from '../lib/types'

/**
 * Fetch the current user's billing status.
 *
 * Pass ``{ enabled: false }`` to suppress the network request — used on
 * public pages (e.g. ``/pricing``) that render for unauthenticated
 * visitors. Firing ``GET /api/v1/billing/status`` unconditionally on
 * public pages would produce a user-visible 401 in DevTools and, via
 * the axios 401 interceptor, kick off a token-refresh round-trip for a
 * session that doesn't exist.
 */
export function useBillingStatus(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options
  return useQuery({
    queryKey: ['billing-status'],
    queryFn: getBillingStatus,
    enabled,
    // Refresh after returning from Stripe checkout/portal
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })
}

/**
 * Args accepted by the checkout mutation.
 *
 * Supports both the modern object form (`{ plan, interval }`) and — for
 * backward compatibility with any caller that hasn't been migrated yet — the
 * legacy bare-plan string form. When a bare string is passed we let the backend
 * fall back to its default interval (monthly).
 */
export type CheckoutArgs = { plan: PaidPlan; interval?: BillingInterval } | PaidPlan

export function useCreateCheckout() {
  return useMutation({
    mutationFn: (args: CheckoutArgs) => {
      if (typeof args === 'string') {
        return createCheckoutSession(args)
      }
      return createCheckoutSession(args.plan, args.interval)
    },
    onSuccess: ({ url }) => {
      window.location.href = url
    },
  })
}

export function useCreatePortal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createPortalSession,
    onSuccess: ({ url }) => {
      // Invalidate billing status when returning from portal
      void queryClient.invalidateQueries({ queryKey: ['billing-status'] })
      window.location.href = url
    },
  })
}
