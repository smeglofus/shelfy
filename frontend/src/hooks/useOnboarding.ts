import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  completeOnboarding,
  getOnboardingStatus,
  resetOnboarding,
  skipOnboarding,
} from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useIsDemoMode } from '../features/demo/DemoContext'

export const ONBOARDING_QUERY_KEY = ['onboarding']

/**
 * Fetch onboarding status. Gated on ``isAuthenticated`` so the onboarding
 * wizard doesn't flash for logged-out visitors during an auth transition
 * (see #125).
 *
 * In the client-side demo (#285) the query is disabled entirely — there is no
 * account to onboard, so the wizard must never appear.
 */
export function useOnboardingStatus() {
  const { isAuthenticated } = useAuth()
  const isDemo = useIsDemoMode()
  return useQuery({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: getOnboardingStatus,
    staleTime: 5 * 60 * 1000, // 5 min — rarely changes
    retry: false,
    enabled: isAuthenticated && !isDemo,
  })
}

export function useCompleteOnboarding() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: completeOnboarding,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY })
    },
  })
}

export function useSkipOnboarding() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: skipOnboarding,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY })
    },
  })
}

export function useResetOnboarding() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: resetOnboarding,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY })
    },
  })
}
