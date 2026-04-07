import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createCheckoutSession, createPortalSession, getBillingStatus } from '../lib/api'

export function useBillingStatus() {
  return useQuery({
    queryKey: ['billing-status'],
    queryFn: getBillingStatus,
    // Refresh after returning from Stripe checkout/portal
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })
}

export function useCreateCheckout() {
  return useMutation({
    mutationFn: (plan: 'pro' | 'library') => createCheckoutSession(plan),
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
