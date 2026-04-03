import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  addLibraryMember,
  listLibraries,
  listLibraryMembers,
  removeLibraryMember,
  updateLibraryMember,
} from '../lib/api'
import type { AddMemberRequest, LibraryRole } from '../lib/types'

export function useLibraries() {
  return useQuery({
    queryKey: ['libraries'],
    queryFn: listLibraries,
  })
}

export function useLibraryMembers(libraryId: string | null) {
  return useQuery({
    queryKey: ['library-members', libraryId],
    queryFn: () => listLibraryMembers(libraryId!),
    enabled: !!libraryId,
  })
}

export function useAddMember(libraryId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: AddMemberRequest) => addLibraryMember(libraryId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['library-members', libraryId] })
    },
  })
}

export function useUpdateMember(libraryId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: LibraryRole }) =>
      updateLibraryMember(libraryId, userId, { role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['library-members', libraryId] })
    },
  })
}

export function useRemoveMember(libraryId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => removeLibraryMember(libraryId, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['library-members', libraryId] })
    },
  })
}
