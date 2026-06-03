import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useTranslation } from 'react-i18next'

import {
  confirmShelfScan,
  formatApiError,
  getShelfScanResult,
  listBooksByLocation,
  scanShelf,
} from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useIsDemoMode } from '../features/demo/DemoContext'
import { useToastStore } from '../lib/toast-store'
import { useDemoStore } from '../store/useDemoStore'
import type { ShelfScanConfirmRequest } from '../lib/types'
import { BOOKS_QUERY_KEY, DEMO_QUERY_KEY } from './useBooks'

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
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['shelf-scan', jobId],
    queryFn: () => getShelfScanResult(jobId as string),
    enabled: isAuthenticated && Boolean(jobId),
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
  const showSuccess = useToastStore((state) => state.showSuccess)
  const { t } = useTranslation()
  const isDemo = useIsDemoMode()

  return useMutation({
    mutationFn: async (payload: ShelfScanConfirmRequest) =>
      isDemo ? useDemoStore.getState().confirmShelfScan(payload) : confirmShelfScan(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: isDemo ? DEMO_QUERY_KEY : BOOKS_QUERY_KEY })
      showSuccess(t('toast.scan_confirmed', 'Books saved to your library!'))
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}

export function useBooksByLocation(locationId: string | null) {
  const { isAuthenticated } = useAuth()
  const isDemo = useIsDemoMode()
  return useQuery({
    queryKey: isDemo ? [...DEMO_QUERY_KEY, 'books-by-location', locationId] : ['books-by-location', locationId],
    queryFn: () =>
      isDemo
        ? useDemoStore.getState().booksByLocation(locationId as string)
        : listBooksByLocation(locationId as string),
    enabled: (isDemo || isAuthenticated) && Boolean(locationId),
    retry: false,
  })
}
