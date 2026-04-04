import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  completeOnboarding,
  getOnboardingStatus,
  resetOnboarding,
  skipOnboarding,
} from '../lib/api'

export const ONBOARDING_QUERY_KEY = ['onboarding']

export function useOnboardingStatus() {
  return useQuery({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: getOnboardingStatus,
    staleTime: 5 * 60 * 1000, // 5 min — rarely changes
    retry: false,
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
