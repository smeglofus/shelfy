import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { anonymizeBorrower, formatApiError, getBorrower, listBorrowerLoans, listBorrowers } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useToastStore } from '../lib/toast-store'

export const BORROWERS_QUERY_KEY = ['borrowers']
const borrowerKey = (id: string) => ['borrower', id]
const borrowerLoansKey = (id: string) => ['borrower', id, 'loans']

export function useBorrowers() {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: BORROWERS_QUERY_KEY,
    queryFn: listBorrowers,
    retry: false,
    enabled: isAuthenticated,
  })
}

export function useBorrower(id: string) {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: borrowerKey(id),
    queryFn: () => getBorrower(id),
    retry: false,
    enabled: isAuthenticated && Boolean(id),
  })
}

export function useBorrowerLoans(id: string) {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: borrowerLoansKey(id),
    queryFn: () => listBorrowerLoans(id),
    retry: false,
    enabled: isAuthenticated && Boolean(id),
  })
}

export function useAnonymizeBorrower() {
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (id: string) => anonymizeBorrower(id),
    onSuccess: async (anonymizedBorrower) => {
      // The borrower list, the borrower detail, and the borrower's loans
      // (denormalized borrower text) all change at once. Invalidate broadly
      // rather than try to splice one row in.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: BORROWERS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: borrowerKey(anonymizedBorrower.id) }),
        queryClient.invalidateQueries({ queryKey: borrowerLoansKey(anonymizedBorrower.id) }),
        // Loan rows on book pages also carry denormalized borrower text.
        queryClient.invalidateQueries({ queryKey: ['loans'] }),
        queryClient.invalidateQueries({ queryKey: ['books'] }),
      ])
      showSuccess(t('toast.borrower_anonymized', 'Borrower anonymized.'))
    },
    onError: (error: unknown) => showError(formatApiError(error)),
  })
}
