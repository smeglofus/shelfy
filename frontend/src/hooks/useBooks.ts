import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createBook, deleteBook, formatApiError, getBook, listBooks, updateBook } from '../lib/api'
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
