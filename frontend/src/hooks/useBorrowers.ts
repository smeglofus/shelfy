import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { anonymizeBorrower, formatApiError, getBorrower, listBorrowerLoans, listBorrowers, mergeBorrowers, updateBorrower } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useToastStore } from '../lib/toast-store'
import type { BorrowerListParams, BorrowerUpdateRequest } from '../lib/types'

export const BORROWERS_QUERY_KEY = ['borrowers']
const borrowersListKey = (params: BorrowerListParams) =>
  ['borrowers', params.search ?? '', params.page ?? 1, params.pageSize ?? 20] as const
const borrowerKey = (id: string) => ['borrower', id]
const borrowerLoansKey = (id: string) => ['borrower', id, 'loans']

export function useBorrowers(params: BorrowerListParams = {}) {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: borrowersListKey(params),
    queryFn: () => listBorrowers(params),
    retry: false,
    enabled: isAuthenticated,
    placeholderData: (previous) => previous,
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

export function useUpdateBorrower() {
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: BorrowerUpdateRequest }) =>
      updateBorrower(id, payload),
    onSuccess: async (updated) => {
      // ADR 008: edits do NOT propagate to historical loan rows. Only the
      // borrower-level caches need invalidating.
      // Invalidate every page/search variant of the borrowers list under
      // BORROWERS_QUERY_KEY (TanStack invalidates by prefix).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: BORROWERS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: borrowerKey(updated.id) }),
      ])
      showSuccess(t('toast.borrower_saved', 'Borrower saved.'))
    },
    onError: (error: unknown) => showError(formatApiError(error)),
  })
}

export function useMergeBorrowers() {
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ targetId, sourceId }: { targetId: string; sourceId: string }) =>
      mergeBorrowers(targetId, sourceId),
    onSuccess: async (target, { sourceId }) => {
      // Source row is gone; target's loans changed; loan caches on book pages
      // carry borrower nesting so they need a refresh too.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: BORROWERS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: borrowerKey(target.id) }),
        queryClient.invalidateQueries({ queryKey: borrowerLoansKey(target.id) }),
        queryClient.invalidateQueries({ queryKey: borrowerKey(sourceId) }),
        queryClient.invalidateQueries({ queryKey: borrowerLoansKey(sourceId) }),
        queryClient.invalidateQueries({ queryKey: ['loans'] }),
        queryClient.invalidateQueries({ queryKey: ['books'] }),
      ])
      showSuccess(t('toast.borrowers_merged', 'Borrowers merged.'))
    },
    onError: (error: unknown) => showError(formatApiError(error)),
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
