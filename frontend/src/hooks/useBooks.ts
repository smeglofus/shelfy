import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
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
import type { BookCreateRequest, BookListParams, BookUpdateRequest } from '../lib/types'

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

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: BookUpdateRequest }) => updateBook(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY })
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}

export function useDeleteBook() {
  const queryClient = useQueryClient()
  const showError = useToastStore((state) => state.showError)

  return useMutation({
    mutationFn: (id: string) => deleteBook(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY })
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

export function useJobStatus(jobId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['jobs', jobId],
    queryFn: () => getJobStatus(jobId ?? ''),
    enabled: enabled && !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (!status || status === 'pending' || status === 'processing') {
        return 2000
      }
      return false
    },
    retry: false,
  })
}
