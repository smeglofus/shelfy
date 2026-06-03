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
import { useIsDemoMode } from '../features/demo/DemoContext'
import { useDemoStore } from '../store/useDemoStore'
import type { BookCreateRequest, BookListParams, BookUpdateRequest, BulkDeleteRequest, BulkMoveRequest, BulkStatusRequest } from '../lib/types'
import { useTranslation } from 'react-i18next'

export const BOOKS_QUERY_KEY = ['books']

/**
 * Query-key prefix for the client-side demo (#285).
 *
 * Demo-aware hooks read/write the in-memory ``useDemoStore`` instead of the
 * network. They live under a separate ``['demo', …]`` key space so demo
 * invalidations never disturb the authenticated cache (and vice-versa), and
 * so prod-only invalidators like ``useScan``/``useEnrich`` (which hit
 * ``BOOKS_QUERY_KEY``) are inert inside the demo.
 */
export const DEMO_QUERY_KEY = ['demo']

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
  const isDemo = useIsDemoMode()
  return useQuery({
    queryKey: isDemo ? [...DEMO_QUERY_KEY, ...BOOKS_QUERY_KEY, params] : [...BOOKS_QUERY_KEY, params],
    queryFn: () => (isDemo ? useDemoStore.getState().queryBooks(params) : listBooks(params)),
    retry: false,
    enabled: isDemo || isAuthenticated,
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
  const isDemo = useIsDemoMode()
  return useQuery({
    queryKey: isDemo ? [...DEMO_QUERY_KEY, ...BOOKS_SHELF_QUERY_KEY] : BOOKS_SHELF_QUERY_KEY,
    queryFn: () => (isDemo ? useDemoStore.getState().booksForShelf() : listBooksForShelf()),
    retry: false,
    enabled: isDemo || isAuthenticated,
  })
}

export function useBook(bookId: string) {
  const { isAuthenticated } = useAuth()
  const isDemo = useIsDemoMode()
  return useQuery({
    queryKey: isDemo
      ? [...DEMO_QUERY_KEY, ...BOOKS_QUERY_KEY, 'detail', bookId]
      : [...BOOKS_QUERY_KEY, 'detail', bookId],
    queryFn: () => {
      if (!isDemo) return getBook(bookId)
      const found = useDemoStore.getState().books.find((b) => b.id === bookId)
      if (!found) throw new Error('Book not found')
      return found
    },
    retry: false,
    enabled: (isDemo || isAuthenticated) && Boolean(bookId),
  })
}

export function useCreateBook() {
  const queryClient = useQueryClient()
  const showError = useToastStore((state) => state.showError)
  const isDemo = useIsDemoMode()

  return useMutation({
    mutationFn: async (payload: BookCreateRequest) =>
      isDemo ? useDemoStore.getState().addBook(payload) : createBook(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: isDemo ? DEMO_QUERY_KEY : BOOKS_QUERY_KEY })
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
  const isDemo = useIsDemoMode()

  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: BookUpdateRequest }) =>
      isDemo ? useDemoStore.getState().updateBook(id, payload) : updateBook(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: isDemo ? DEMO_QUERY_KEY : BOOKS_QUERY_KEY })
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
  const isDemo = useIsDemoMode()

  return useMutation({
    mutationFn: async (id: string) => {
      if (isDemo) {
        useDemoStore.getState().deleteBook(id)
        return
      }
      return deleteBook(id)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: isDemo ? DEMO_QUERY_KEY : BOOKS_QUERY_KEY })
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
  const isDemo = useIsDemoMode()
  return useMutation({
    mutationFn: async (payload: BulkDeleteRequest) => {
      if (isDemo) {
        useDemoStore.getState().bulkDelete(payload.ids)
        return { affected: payload.ids.length, operation: 'delete' as const }
      }
      return bulkDeleteBooks(payload)
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: isDemo ? DEMO_QUERY_KEY : BOOKS_QUERY_KEY })
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
  const isDemo = useIsDemoMode()
  return useMutation({
    mutationFn: async (payload: BulkMoveRequest) => {
      if (isDemo) {
        useDemoStore.getState().bulkMove(payload.ids, payload.location_id)
        return { affected: payload.ids.length, operation: 'move' as const }
      }
      return bulkMoveBooks(payload)
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: isDemo ? DEMO_QUERY_KEY : BOOKS_QUERY_KEY })
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
  const isDemo = useIsDemoMode()
  return useMutation({
    mutationFn: async (payload: BulkStatusRequest) => {
      if (isDemo) {
        useDemoStore.getState().bulkUpdateStatus(payload.ids, payload.reading_status)
        return { affected: payload.ids.length, operation: 'status' as const }
      }
      return bulkUpdateStatus(payload)
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: isDemo ? DEMO_QUERY_KEY : BOOKS_QUERY_KEY })
      showSuccess(t('bulk.status_updated', { count: data.affected }))
    },
    onError: (error: unknown) => showError(formatApiError(error)),
  })
}

export function useBookCounts() {
  const { isAuthenticated } = useAuth()
  const isDemo = useIsDemoMode()
  const opts = { retry: false, enabled: isDemo || isAuthenticated, staleTime: 30_000 } as const
  // In demo, the in-memory store returns the same ``BookListResponse`` shape,
  // so only the data source swaps — the ``.total`` read below is identical.
  const fetch = (params: BookListParams) => () =>
    isDemo ? useDemoStore.getState().queryBooks(params) : listBooks(params)
  const key = (...rest: string[]) =>
    isDemo ? [...DEMO_QUERY_KEY, ...BOOKS_QUERY_KEY, 'count', ...rest] : [...BOOKS_QUERY_KEY, 'count', ...rest]
  const total = useQuery({ queryKey: key(), queryFn: fetch({ pageSize: 1 }), ...opts })
  const read = useQuery({ queryKey: key('read'), queryFn: fetch({ readingStatus: 'read', pageSize: 1 }), ...opts })
  const reading = useQuery({ queryKey: key('reading'), queryFn: fetch({ readingStatus: 'reading', pageSize: 1 }), ...opts })
  const lent = useQuery({ queryKey: key('lent'), queryFn: fetch({ readingStatus: 'lent', pageSize: 1 }), ...opts })
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
