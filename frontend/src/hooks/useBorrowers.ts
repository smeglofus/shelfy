import { useQuery } from '@tanstack/react-query'

import { listBorrowers } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

export const BORROWERS_QUERY_KEY = ['borrowers']

export function useBorrowers() {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: BORROWERS_QUERY_KEY,
    queryFn: listBorrowers,
    retry: false,
    enabled: isAuthenticated,
  })
}
