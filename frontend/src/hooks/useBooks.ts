import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  bulkDeleteBooks,
  bulkMoveBooks,
  bulkUpdateStatus,
  createBook,
  deleteBook,
  formatApiError,
  getBook,
  getJobStatus,
  listBooks,
  updateBook,
  uploadBookImage,
} from '../lib/api'
import { useToastStore } from '../lib/toast-store'
import type { BookCreateRequest, BookListParams, BookUpdateRequest, BulkDeleteRequest, BulkMoveRequest, BulkStatusRequest } from '../lib/types'
import { useTranslation } from 'react-i18next'

export const BOOKS_QUERY_KEY = ['books']

export function useBooks(params: BookListParams) {
  return useQuery({
    queryKey: [...BOOKS_QUERY_KEY, params],
    queryFn: () => listBooks(params),
    retry: false,
  })
}

export function useBook(bookId: string) {
  return useQuery({
    queryKey: [...BOOKS_QUERY_KEY, 'detail', bookId],
    queryFn: () => getBook(bookId),
    retry: false,
  })
}

export function useCreateBook() {
  const queryClient = useQueryClient()
  const showError = useToastStore((state) => state.showError)

  return useMutation({
    mutationFn: (payload: BookCreateRequest) => createBook(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY })
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}

export function useUpdateBook() {
  const queryClient = useQueryClient()
  const showError = useToastStore((state) => state.showError)
  const showSuccess = useToastStore((state) => state.showSuccess)
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: BookUpdateRequest }) => updateBook(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY })
      showSuccess(t('toast.book_saved', 'Changes saved successfully.'))
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}

export function useDeleteBook() {
  const queryClient = useQueryClient()
  const showError = useToastStore((state) => state.showError)
  const showSuccess = useToastStore((state) => state.showSuccess)
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (id: string) => deleteBook(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY })
      showSuccess(t('toast.book_deleted', 'Book deleted.'))
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}

export function useUploadBookImage() {
  const showError = useToastStore((state) => state.showError)

  return useMutation({
    mutationFn: (file: File) => uploadBookImage(file),
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}

export function useBulkDeleteBooks() {
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (payload: BulkDeleteRequest) => bulkDeleteBooks(payload),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY })
      showSuccess(t('bulk.deleted', { count: data.affected }))
    },
    onError: (error: unknown) => showError(formatApiError(error)),
  })
}

export function useBulkMoveBooks() {
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (payload: BulkMoveRequest) => bulkMoveBooks(payload),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY })
      showSuccess(t('bulk.moved', { count: data.affected }))
    },
    onError: (error: unknown) => showError(formatApiError(error)),
  })
}

export function useBulkUpdateStatus() {
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (payload: BulkStatusRequest) => bulkUpdateStatus(payload),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY })
      showSuccess(t('bulk.status_updated', { count: data.affected }))
    },
    onError: (error: unknown) => showError(formatApiError(error)),
  })
}

export function useJobStatus(jobId: string | null) {
  return useQuery({
    queryKey: ['job-status', jobId],
    queryFn: () => getJobStatus(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'done' || status === 'failed' ? false : 2000
    },
    retry: false,
  })
}
