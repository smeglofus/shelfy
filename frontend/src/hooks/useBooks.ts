import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  bulkDeleteBooks,
  bulkMoveBooks,
  bulkUpdateStatus,
  clearSampleLibrary,
  createBook,
  deleteBook,
  formatApiError,
  getBook,
  getJobStatus,
  listBooks,
  listBooksForShelf,
  updateBook,
  uploadBookImage,
} from '../lib/api'
import { useToastStore } from '../lib/toast-store'
import { useAuth } from '../contexts/AuthContext'
import type { BookCreateRequest, BookListParams, BookUpdateRequest, BulkDeleteRequest, BulkMoveRequest, BulkStatusRequest } from '../lib/types'
import { useTranslation } from 'react-i18next'

export const BOOKS_QUERY_KEY = ['books']

/**
 * List books for the current user.
 *
 * Gated on ``isAuthenticated`` as defense-in-depth — in practice ``BooksPage``
 * only mounts under ``ProtectedRoute``, but issue #125 showed that any page
 * mounting while auth is mid-transition can fire a query prematurely and end
 * up with a "failed+not-retried" cache entry that survives until refresh.
 * Gating here keeps the cache clean when auth isn't settled yet.
 */
export function useBooks(params: BookListParams) {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: [...BOOKS_QUERY_KEY, params],
    queryFn: () => listBooks(params),
    retry: false,
    enabled: isAuthenticated,
  })
}

/**
 * Fetch the complete book dataset for bookshelf rendering.
 *
 * Unlike ``useBooks``, this is unpaginated — required because BookshelfView
 * needs every book in every location to build a correct reorder payload
 * (issue #128). Reorder-/move-/delete-/create-book mutations still hit the
 * ``BOOKS_QUERY_KEY`` prefix on invalidation, which matches this key too.
 */
export const BOOKS_SHELF_QUERY_KEY = [...BOOKS_QUERY_KEY, 'shelf']

export function useBooksForShelf() {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: BOOKS_SHELF_QUERY_KEY,
    queryFn: () => listBooksForShelf(),
    retry: false,
    enabled: isAuthenticated,
  })
}

export function useBook(bookId: string) {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: [...BOOKS_QUERY_KEY, 'detail', bookId],
    queryFn: () => getBook(bookId),
    retry: false,
    enabled: isAuthenticated && Boolean(bookId),
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

export function useBookCounts() {
  const { isAuthenticated } = useAuth()
  const opts = { retry: false, enabled: isAuthenticated, staleTime: 30_000 } as const
  const total = useQuery({ queryKey: [...BOOKS_QUERY_KEY, 'count'], queryFn: () => listBooks({ pageSize: 1 }), ...opts })
  const read = useQuery({ queryKey: [...BOOKS_QUERY_KEY, 'count', 'read'], queryFn: () => listBooks({ readingStatus: 'read', pageSize: 1 }), ...opts })
  const reading = useQuery({ queryKey: [...BOOKS_QUERY_KEY, 'count', 'reading'], queryFn: () => listBooks({ readingStatus: 'reading', pageSize: 1 }), ...opts })
  const lent = useQuery({ queryKey: [...BOOKS_QUERY_KEY, 'count', 'lent'], queryFn: () => listBooks({ readingStatus: 'lent', pageSize: 1 }), ...opts })
  return {
    total: total.data?.total ?? 0,
    read: read.data?.total ?? 0,
    reading: reading.data?.total ?? 0,
    lent: lent.data?.total ?? 0,
    isLoading: total.isLoading,
  }
}

export function useClearSampleLibrary() {
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)
  const { t } = useTranslation()
  return useMutation({
    mutationFn: clearSampleLibrary,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY })
      showSuccess(t('books.sample_cleared'))
    },
    onError: (error: unknown) => showError(formatApiError(error)),
  })
}

export function useJobStatus(jobId: string | null) {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['job-status', jobId],
    queryFn: () => getJobStatus(jobId as string),
    enabled: isAuthenticated && Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'done' || status === 'failed' ? false : 2000
    },
    retry: false,
  })
}
