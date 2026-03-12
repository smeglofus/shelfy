import { useMemo, useState } from 'react'

import { useCreateLocation, useDeleteLocation, useLocations, useUpdateLocation } from '../hooks/useLocations'
import { formatApiError } from '../lib/api'
import { useToastStore } from '../lib/toast-store'
import type { Location } from '../lib/types'

interface LocationFormValues {
  room: string
  furniture: string
  shelf: string
}

const EMPTY_FORM: LocationFormValues = {
  room: '',
  furniture: '',
  shelf: '',
}

export function LocationsPage() {
  const locationsQuery = useLocations()
  const createMutation = useCreateLocation()
  const updateMutation = useUpdateLocation()
  const deleteMutation = useDeleteLocation()
  const showError = useToastStore((state) => state.showError)

  const [createForm, setCreateForm] = useState<LocationFormValues>(EMPTY_FORM)
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<LocationFormValues>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null)

  const sortedLocations = useMemo(() => {
    return [...(locationsQuery.data ?? [])].sort((a, b) => {
      const left = `${a.room}/${a.furniture}/${a.shelf}`.toLowerCase()
      const right = `${b.room}/${b.furniture}/${b.shelf}`.toLowerCase()
      return left.localeCompare(right)
    })
  }, [locationsQuery.data])

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2>Locations</h2>
      <p>Manage room / furniture / shelf combinations.</p>

      <form
        aria-label="create-location-form"
        onSubmit={(event) => {
          event.preventDefault()
          createMutation.mutate(createForm, {
            onSuccess: () => setCreateForm(EMPTY_FORM),
          })
        }}
        style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}
      >
        <input
          aria-label="Room"
          required
          placeholder="Room"
          value={createForm.room}
          onChange={(event) => setCreateForm((prev) => ({ ...prev, room: event.target.value }))}
        />
        <input
          aria-label="Furniture"
          required
          placeholder="Furniture"
          value={createForm.furniture}
          onChange={(event) => setCreateForm((prev) => ({ ...prev, furniture: event.target.value }))}
        />
        <input
          aria-label="Shelf"
          required
          placeholder="Shelf"
          value={createForm.shelf}
          onChange={(event) => setCreateForm((prev) => ({ ...prev, shelf: event.target.value }))}
        />
        <button type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? 'Creating…' : 'Create location'}
        </button>
      </form>

      {locationsQuery.isLoading && <p>Loading locations…</p>}

      {locationsQuery.isError && (
        <p>
          Failed to load locations.
          <button
            type="button"
            onClick={() => {
              showError(formatApiError(locationsQuery.error))
              void locationsQuery.refetch()
            }}
          >
            Retry
          </button>
        </p>
      )}

      {!locationsQuery.isLoading && !locationsQuery.isError && sortedLocations.length === 0 && (
        <p>No locations yet.</p>
      )}

      {sortedLocations.length > 0 && (
        <table width="100%" cellPadding={8} style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Room</th>
              <th align="left">Furniture</th>
              <th align="left">Shelf</th>
              <th align="left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedLocations.map((location) => {
              const isEditing = editingLocationId === location.id

              return (
                <tr key={location.id} style={{ borderTop: '1px solid #ddd' }}>
                  <td>{isEditing ? <input aria-label="Edit room" value={editForm.room} onChange={(event) => setEditForm((prev) => ({ ...prev, room: event.target.value }))} /> : location.room}</td>
                  <td>{isEditing ? <input aria-label="Edit furniture" value={editForm.furniture} onChange={(event) => setEditForm((prev) => ({ ...prev, furniture: event.target.value }))} /> : location.furniture}</td>
                  <td>{isEditing ? <input aria-label="Edit shelf" value={editForm.shelf} onChange={(event) => setEditForm((prev) => ({ ...prev, shelf: event.target.value }))} /> : location.shelf}</td>
                  <td style={{ display: 'flex', gap: '0.5rem' }}>
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          disabled={updateMutation.isPending}
                          onClick={() => {
                            updateMutation.mutate(
                              { id: location.id, payload: editForm },
                              { onSuccess: () => setEditingLocationId(null) },
                            )
                          }}
                        >
                          {updateMutation.isPending ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          disabled={updateMutation.isPending}
                          onClick={() => {
                            setEditingLocationId(null)
                            setEditForm(EMPTY_FORM)
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={updateMutation.isPending}
                          onClick={() => {
                            setEditingLocationId(location.id)
                            setEditForm({
                              room: location.room,
                              furniture: location.furniture,
                              shelf: location.shelf,
                            })
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" onClick={() => setDeleteTarget(location)}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="delete-location-dialog"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.3)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <div style={{ background: 'white', padding: '1rem', borderRadius: '0.5rem', width: 360 }}>
            <p>
              Delete <strong>{deleteTarget.room}</strong> / {deleteTarget.furniture} / {deleteTarget.shelf}?
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  deleteMutation.mutate(deleteTarget.id, {
                    onSuccess: () => setDeleteTarget(null),
                  })
                }}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Confirm delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
