import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { anonymizeBorrower, formatApiError, getBorrower, listBorrowerLoans, listBorrowers, mergeBorrowers, restoreBorrower, undoMerge, updateBorrower } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useMergeUndoStore } from '../lib/merge-undo-store'
import { useToastStore } from '../lib/toast-store'
import type { BorrowerListParams, BorrowerUpdateRequest } from '../lib/types'

export const BORROWERS_QUERY_KEY = ['borrowers']
const borrowersListKey = (params: BorrowerListParams) =>
  [
    'borrowers',
    params.search ?? '',
    params.page ?? 1,
    params.pageSize ?? 20,
    params.status ?? 'all',
  ] as const
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
  const setUndo = useMergeUndoStore((s) => s.set)

  return useMutation({
    mutationFn: ({
      targetId,
      sourceId,
    }: {
      targetId: string
      sourceId: string
      sourceName: string
      targetName: string
    }) => mergeBorrowers(targetId, sourceId),
    onSuccess: async (result, { sourceId, sourceName, targetName }) => {
      // Source row is gone; target's loans changed; loan caches on book pages
      // carry borrower nesting so they need a refresh too.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: BORROWERS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: borrowerKey(result.id) }),
        queryClient.invalidateQueries({ queryKey: borrowerLoansKey(result.id) }),
        queryClient.invalidateQueries({ queryKey: borrowerKey(sourceId) }),
        queryClient.invalidateQueries({ queryKey: borrowerLoansKey(sourceId) }),
        queryClient.invalidateQueries({ queryKey: ['loans'] }),
        queryClient.invalidateQueries({ queryKey: ['books'] }),
      ])
      // #244 PR #3: surface the undo toast instead of a fire-and-forget
      // "merged" success — the librarian's escape hatch lives here.
      setUndo({
        token: result.undo_token,
        undoUntil: result.undo_until,
        sourceName,
        targetName,
      })
    },
    onError: (error: unknown) => showError(formatApiError(error)),
  })
}

export function useUndoMerge() {
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)
  const clearUndo = useMergeUndoStore((s) => s.clear)
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (token: string) => undoMerge(token),
    onSuccess: async (restored) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: BORROWERS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: borrowerKey(restored.id) }),
        queryClient.invalidateQueries({ queryKey: borrowerLoansKey(restored.id) }),
        queryClient.invalidateQueries({ queryKey: ['loans'] }),
        queryClient.invalidateQueries({ queryKey: ['books'] }),
      ])
      clearUndo()
      showSuccess(t('toast.borrower_merge_undone'))
    },
    onError: (error: unknown) => {
      // Clear the toast state even on error — the token is consumed /
      // expired either way, leaving the toast up would dangle a button
      // that no longer works.
      clearUndo()
      showError(formatApiError(error))
    },
  })
}

export function useAnonymizeBorrower() {
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ id, immediate = false }: { id: string; immediate?: boolean }) =>
      anonymizeBorrower(id, { immediate }),
    onSuccess: async (resultBorrower, variables) => {
      // The borrower list, the borrower detail, and the borrower's loans
      // (denormalized borrower text) all change at once. Invalidate broadly
      // rather than try to splice one row in.
      //
      // Note: in pending mode (default for #244) loan rows aren't actually
      // touched until the worker finalizes — but invalidating ['loans'] is
      // cheap insurance against any view that derives state from
      // ``pending_anonymization_until``.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: BORROWERS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: borrowerKey(resultBorrower.id) }),
        queryClient.invalidateQueries({ queryKey: borrowerLoansKey(resultBorrower.id) }),
        queryClient.invalidateQueries({ queryKey: ['loans'] }),
        queryClient.invalidateQueries({ queryKey: ['books'] }),
      ])
      // Distinct toasts so the librarian sees what mode they actually used.
      const toastKey = variables.immediate
        ? 'toast.borrower_anonymized'
        : 'toast.borrower_anonymization_scheduled'
      showSuccess(t(toastKey))
    },
    onError: (error: unknown) => showError(formatApiError(error)),
  })
}

export function useRestoreBorrower() {
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (id: string) => restoreBorrower(id),
    onSuccess: async (restoredBorrower) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: BORROWERS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: borrowerKey(restoredBorrower.id) }),
      ])
      showSuccess(t('toast.borrower_restored'))
    },
    onError: (error: unknown) => showError(formatApiError(error)),
  })
}
