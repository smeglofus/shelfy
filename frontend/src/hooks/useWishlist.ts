import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../contexts/AuthContext'
import {
  createWishlistItem,
  deleteWishlistItem,
  listWishlist,
  updateLibrary,
} from '../lib/api'
import type { UpdateLibraryRequest, WishlistItemCreateRequest } from '../lib/types'

export function useWishlist(page: number, pageSize = 20, enabled = true) {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['wishlist', page, pageSize],
    queryFn: () => listWishlist(page, pageSize),
    enabled: isAuthenticated && enabled,
  })
}

export function useCreateWishlistItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: WishlistItemCreateRequest) => createWishlistItem(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wishlist'] })
    },
  })
}

export function useDeleteWishlistItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (itemId: string) => deleteWishlistItem(itemId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wishlist'] })
    },
  })
}

/** Owner-only wishlist toggle (#309). Refreshes the libraries payload so
 *  the nav item and the /wishlist route react immediately. */
export function useToggleWishlist(libraryId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: UpdateLibraryRequest) => updateLibrary(libraryId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['libraries'] })
    },
  })
}
