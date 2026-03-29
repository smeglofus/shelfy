import { useMutation, useQueryClient } from '@tanstack/react-query'

import { enrichAll, enrichBook, enrichByLocation, formatApiError } from '../lib/api'
import { useToastStore } from '../lib/toast-store'
import { BOOKS_QUERY_KEY } from './useBooks'

export function useEnrichBook() {
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)

  return useMutation({
    mutationFn: ({ bookId, force }: { bookId: string; force?: boolean }) =>
      enrichBook(bookId, force),
    onSuccess: async () => {
      // Invalidate after a delay to give the worker time to process
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY })
      }, 3000)
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}

export function useEnrichByLocation() {
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)

  return useMutation({
    mutationFn: ({ locationId, force }: { locationId: string; force?: boolean }) =>
      enrichByLocation(locationId, force),
    onSuccess: async () => {
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY })
      }, 5000)
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}

export function useEnrichAll() {
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)

  return useMutation({
    mutationFn: ({ force }: { force?: boolean } = {}) => enrichAll(force),
    onSuccess: async () => {
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY })
      }, 10000)
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}
