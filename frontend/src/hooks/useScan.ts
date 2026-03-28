import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  confirmShelfScan,
  formatApiError,
  getShelfScanResult,
  listBooksByLocation,
  scanShelf,
} from '../lib/api'
import { useToastStore } from '../lib/toast-store'
import type { ShelfScanConfirmRequest } from '../lib/types'
import { BOOKS_QUERY_KEY } from './useBooks'

export function useScanShelf() {
  const showError = useToastStore((state) => state.showError)

  return useMutation({
    mutationFn: ({ file, locationId }: { file: File; locationId?: string }) =>
      scanShelf(file, locationId),
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}

export function useShelfScanResult(jobId: string | null) {
  return useQuery({
    queryKey: ['shelf-scan', jobId],
    queryFn: () => getShelfScanResult(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'done' || status === 'failed' ? false : 2000
    },
    retry: false,
  })
}

export function useConfirmShelfScan() {
  const queryClient = useQueryClient()
  const showError = useToastStore((state) => state.showError)

  return useMutation({
    mutationFn: (payload: ShelfScanConfirmRequest) => confirmShelfScan(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY })
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}

export function useBooksByLocation(locationId: string | null) {
  return useQuery({
    queryKey: ['books-by-location', locationId],
    queryFn: () => listBooksByLocation(locationId as string),
    enabled: Boolean(locationId),
    retry: false,
  })
}
