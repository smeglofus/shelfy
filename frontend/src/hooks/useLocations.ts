import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useTranslation } from 'react-i18next'

import { createLocation, deleteLocation, formatApiError, listLocations, updateLocation } from '../lib/api'
import { useToastStore } from '../lib/toast-store'
import type { Location, LocationCreateRequest, LocationUpdateRequest } from '../lib/types'

const LOCATIONS_QUERY_KEY = ['locations']

export function useLocations() {
  return useQuery({
    queryKey: LOCATIONS_QUERY_KEY,
    queryFn: listLocations,
    retry: false,
  })
}

export function useCreateLocation() {
  const queryClient = useQueryClient()
  const showError = useToastStore((state) => state.showError)
  const showSuccess = useToastStore((state) => state.showSuccess)
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (payload: LocationCreateRequest) => createLocation(payload),
    onSuccess: (createdLocation) => {
      queryClient.setQueryData<Location[]>(LOCATIONS_QUERY_KEY, (current) => [
        ...(current ?? []),
        createdLocation,
      ])
      showSuccess(t('toast.location_created', 'Location created.'))
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}

export function useUpdateLocation() {
  const queryClient = useQueryClient()
  const showError = useToastStore((state) => state.showError)
  const showSuccess = useToastStore((state) => state.showSuccess)
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: LocationUpdateRequest }) =>
      updateLocation(id, payload),
    onSuccess: (updatedLocation) => {
      queryClient.setQueryData<Location[]>(LOCATIONS_QUERY_KEY, (current) =>
        (current ?? []).map((location) =>
          location.id === updatedLocation.id ? updatedLocation : location,
        ),
      )
      showSuccess(t('toast.location_saved', 'Location saved.'))
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}

export function useDeleteLocation() {
  const queryClient = useQueryClient()
  const showError = useToastStore((state) => state.showError)
  const showSuccess = useToastStore((state) => state.showSuccess)
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (id: string) => deleteLocation(id),
    onSuccess: (_, deletedId) => {
      queryClient.setQueryData<Location[]>(LOCATIONS_QUERY_KEY, (current) =>
        (current ?? []).filter((location) => location.id !== deletedId),
      )
      showSuccess(t('toast.location_deleted', 'Location deleted.'))
    },
    onError: (error: unknown) => {
      showError(formatApiError(error))
    },
  })
}
