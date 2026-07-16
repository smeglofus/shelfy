import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  addLibraryMember,
  createLibrary,
  listLibraries,
  listLibraryMembers,
  removeLibraryMember,
  updateLibrary,
  updateLibraryMember,
} from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { AddMemberRequest, CreateLibraryRequest, LibraryRole, UpdateLibraryRequest } from '../lib/types'

export function useLibraries() {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['libraries'],
    queryFn: listLibraries,
    enabled: isAuthenticated,
  })
}

export function useCreateLibrary() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateLibraryRequest) => createLibrary(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['libraries'] })
    },
  })
}

/** Owner-only library settings (rename, …). Refreshes the libraries payload
 *  so the header and settings react immediately. */
export function useUpdateLibrary(libraryId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: UpdateLibraryRequest) => updateLibrary(libraryId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['libraries'] })
    },
  })
}

export function useLibraryMembers(libraryId: string | null) {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['library-members', libraryId],
    queryFn: () => listLibraryMembers(libraryId!),
    enabled: isAuthenticated && !!libraryId,
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
