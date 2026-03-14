import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createBook, deleteBook, formatApiError, getBook, listBooks, updateBook } from '../lib/api'
import { useToastStore } from '../lib/toast-store'
import type {
  Book,
  BookCreateRequest,
  BookListParams,
  BookListResponse,
  BookUpdateRequest,
} from '../lib/types'

const BOOKS_QUERY_KEY = ['books']

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

export function useCreateBook(paramsForListUpdate: BookListParams) {
  const queryClient = useQueryClient()
  const showError = useToastStore((state) => state.showError)

  return useMutation({
    mutationFn: (payload: BookCreateRequest) => createBook(payload),
    onSuccess: (createdBook) => {
      queryClient.setQueryData<BookListResponse>([...BOOKS_QUERY_KEY, paramsForListUpdate], (current) => {
        if (!current) {
          return current
        }

        return {
          ...current,
          total: current.total + 1,
          items: [createdBook, ...current.items],
        }
      })
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}

export function useUpdateBook(paramsForListUpdate: BookListParams) {
  const queryClient = useQueryClient()
  const showError = useToastStore((state) => state.showError)

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: BookUpdateRequest }) => updateBook(id, payload),
    onSuccess: (updatedBook) => {
      queryClient.setQueryData<BookListResponse>([...BOOKS_QUERY_KEY, paramsForListUpdate], (current) => {
        if (!current) {
          return current
        }

        return {
          ...current,
          items: current.items.map((book) => (book.id === updatedBook.id ? updatedBook : book)),
        }
      })

      queryClient.setQueryData<Book>([...BOOKS_QUERY_KEY, 'detail', updatedBook.id], updatedBook)
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}

export function useDeleteBook(paramsForListUpdate: BookListParams) {
  const queryClient = useQueryClient()
  const showError = useToastStore((state) => state.showError)

  return useMutation({
    mutationFn: (id: string) => deleteBook(id),
    onSuccess: (_, deletedId) => {
      queryClient.setQueryData<BookListResponse>([...BOOKS_QUERY_KEY, paramsForListUpdate], (current) => {
        if (!current) {
          return current
        }

        return {
          ...current,
          total: Math.max(0, current.total - 1),
          items: current.items.filter((book) => book.id !== deletedId),
        }
      })

      queryClient.removeQueries({ queryKey: [...BOOKS_QUERY_KEY, 'detail', deletedId] })
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}
