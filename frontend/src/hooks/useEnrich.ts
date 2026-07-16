import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { useTranslation } from 'react-i18next'

import { enrichAll, enrichBook, enrichByLocation, formatApiError } from '../lib/api'
import { useToastStore } from '../lib/toast-store'
import { BOOKS_QUERY_KEY } from './useBooks'

/** Batch enrichment runs in the background (~1 s per book in the worker) —
 *  refresh the list a few times over the next minutes so results show up
 *  progressively without a manual reload. */
function scheduleStaggeredRefetch(queryClient: QueryClient, delaysSeconds: number[]) {
  for (const delay of delaysSeconds) {
    setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY })
    }, delay * 1000)
  }
}

export function useEnrichBook() {
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)
  const showInfo = useToastStore((s) => s.showInfo)
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ bookId, force }: { bookId: string; force?: boolean }) =>
      enrichBook(bookId, force),
    onSuccess: async () => {
      showInfo(t('toast.enrich_started', 'Enrichment started. Data will update shortly.'))
      scheduleStaggeredRefetch(queryClient, [3, 8])
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}

export function useEnrichByLocation() {
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)
  const showInfo = useToastStore((s) => s.showInfo)
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ locationId, force }: { locationId: string; force?: boolean }) =>
      enrichByLocation(locationId, force),
    onSuccess: async (data) => {
      showInfo(t('toast.enrich_batch_started', { count: data.book_count }))
      scheduleStaggeredRefetch(queryClient, [5, 15, 30, 60, 120])
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}

export function useEnrichAll() {
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)
  const showInfo = useToastStore((s) => s.showInfo)
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ force }: { force?: boolean } = {}) => enrichAll(force),
    onSuccess: async (data) => {
      showInfo(t('toast.enrich_batch_started', { count: data.book_count }))
      scheduleStaggeredRefetch(queryClient, [5, 15, 30, 60, 120, 240])
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}
