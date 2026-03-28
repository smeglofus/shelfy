import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createLoan, formatApiError, listLoans, returnLoan } from '../lib/api'
import { useToastStore } from '../lib/toast-store'
import type { LoanCreateRequest, LoanReturnRequest } from '../lib/types'

const loansKey = (bookId: string) => ['loans', bookId]

export function useLoans(bookId: string) {
  return useQuery({
    queryKey: loansKey(bookId),
    queryFn: () => listLoans(bookId),
    enabled: Boolean(bookId),
    retry: false,
  })
}

export function useCreateLoan(bookId: string) {
  const queryClient = useQueryClient()
  const showError = useToastStore((state) => state.showError)

  return useMutation({
    mutationFn: (payload: LoanCreateRequest) => createLoan(bookId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: loansKey(bookId) })
      await queryClient.invalidateQueries({ queryKey: ['books'] })
    },
    onError: (error: unknown) => showError(formatApiError(error)),
  })
}

export function useReturnLoan(bookId: string) {
  const queryClient = useQueryClient()
  const showError = useToastStore((state) => state.showError)

  return useMutation({
    mutationFn: ({ loanId, payload }: { loanId: string; payload: LoanReturnRequest }) => returnLoan(bookId, loanId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: loansKey(bookId) })
      await queryClient.invalidateQueries({ queryKey: ['books'] })
    },
    onError: (error: unknown) => showError(formatApiError(error)),
  })
}
