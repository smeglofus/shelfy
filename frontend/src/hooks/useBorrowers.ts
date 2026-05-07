import { useQuery } from '@tanstack/react-query'

import { getBorrower, listBorrowerLoans, listBorrowers } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

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
