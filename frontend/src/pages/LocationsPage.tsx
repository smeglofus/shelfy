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
    <section className="container" style={{ paddingTop: 24, paddingBottom: 40, maxWidth: 800 }}>
      <h2 className="text-h2" style={{ marginBottom: 4 }}>Správa umístění</h2>
      <p className="text-p" style={{ color: 'var(--sh-text-muted)', marginBottom: 24 }}>Spravujte seznam místností, nábytku a polic pro rychlé řazení knih.</p>

      <div style={{ background: 'var(--sh-surface)', padding: 20, borderRadius: 'var(--sh-radius-lg)', border: '1px solid var(--sh-border)', marginBottom: 32, boxShadow: 'var(--sh-shadow-sm)' }}>
        <h3 className="text-h3" style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>Přidat nové umístění</h3>
        <form
          aria-label="create-location-form"
          onSubmit={(event) => {
            event.preventDefault()
            createMutation.mutate(createForm, {
              onSuccess: () => setCreateForm(EMPTY_FORM),
            })
          }}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, alignItems: 'end' }}
        >
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 6 }}>Místnost</label>
            <input
              className="sh-input"
              aria-label="Room"
              required
              placeholder="např. Obývák"
              value={createForm.room}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, room: event.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 6 }}>Knihovna</label>
            <input
              className="sh-input"
              aria-label="Furniture"
              required
              placeholder="např. Billy 1"
              value={createForm.furniture}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, furniture: event.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 6 }}>Police</label>
            <input
              className="sh-input"
              aria-label="Shelf"
              required
              placeholder="např. 3 odspodu"
              value={createForm.shelf}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, shelf: event.target.value }))}
            />
          </div>
          <button type="submit" className="sh-btn-primary hover-scale" disabled={createMutation.isPending} style={{ padding: '12px 16px' }}>
            {createMutation.isPending ? 'Přidávám…' : 'Vytvořit'}
          </button>
        </form>
      </div>

      {locationsQuery.isLoading && <p className="text-p">Načítám lokace…</p>}

      {locationsQuery.isError && (
        <div style={{ padding: 16, background: 'var(--sh-red)', color: 'white', borderRadius: 'var(--sh-radius-md)' }}>
          <p style={{ margin: 0, marginBottom: 12 }}>Chyba při načítání lokací.</p>
          <button
            type="button"
            className="sh-btn-secondary hover-scale"
            style={{ border: 'none', background: 'white', color: 'var(--sh-red)' }}
            onClick={() => {
              showError(formatApiError(locationsQuery.error))
              void locationsQuery.refetch()
            }}
          >
            Zkusit znovu
          </button>
        </div>
      )}

      {!locationsQuery.isLoading && !locationsQuery.isError && sortedLocations.length === 0 && (
        <div style={{ textAlign: 'center', padding: '64px 24px', background: 'var(--sh-surface)', borderRadius: 'var(--sh-radius-lg)', border: '1px dashed var(--sh-border-2)' }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.8 }}>🗺️</div>
          <p className="text-h3" style={{ marginBottom: 8, color: 'var(--sh-text-main)' }}>
            Zatím žádná umístění
          </p>
          <p className="text-p" style={{ color: 'var(--sh-text-muted)' }}>Vytvořte své první umístění výše, ať víte, kde své knihy najít.</p>
        </div>
      )}

      {sortedLocations.length > 0 && (
        <div style={{ borderRadius: 'var(--sh-radius-lg)', border: '1px solid var(--sh-border)', overflow: 'hidden', background: 'var(--sh-surface)' }}>
          <table width="100%" cellPadding={16} style={{ borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
            <thead style={{ background: 'rgba(0,0,0,0.02)', borderBottom: '1px solid var(--sh-border)' }}>
              <tr>
                <th style={{ fontWeight: 600, color: 'var(--sh-text-muted)', whiteSpace: 'nowrap' }}>Místnost</th>
                <th style={{ fontWeight: 600, color: 'var(--sh-text-muted)', whiteSpace: 'nowrap' }}>Knihovna</th>
                <th style={{ fontWeight: 600, color: 'var(--sh-text-muted)', whiteSpace: 'nowrap' }}>Police</th>
                <th style={{ fontWeight: 600, color: 'var(--sh-text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>Akce</th>
              </tr>
            </thead>
            <tbody>
              {sortedLocations.map((location) => {
                const isEditing = editingLocationId === location.id

                return (
                  <tr key={location.id} style={{ borderBottom: '1px solid var(--sh-border)', transition: 'background 0.2s', background: isEditing ? 'rgba(0,0,0,0.01)' : 'transparent' }}>
                    <td>{isEditing ? <input className="sh-input" aria-label="Edit room" value={editForm.room} onChange={(event) => setEditForm((prev) => ({ ...prev, room: event.target.value }))} /> : <span style={{ fontWeight: 500 }}>{location.room}</span>}</td>
                    <td>{isEditing ? <input className="sh-input" aria-label="Edit furniture" value={editForm.furniture} onChange={(event) => setEditForm((prev) => ({ ...prev, furniture: event.target.value }))} /> : <span style={{ color: 'var(--sh-text-muted)' }}>{location.furniture}</span>}</td>
                    <td>{isEditing ? <input className="sh-input" aria-label="Edit shelf" value={editForm.shelf} onChange={(event) => setEditForm((prev) => ({ ...prev, shelf: event.target.value }))} /> : <span style={{ color: 'var(--sh-text-muted)' }}>{location.shelf}</span>}</td>
                    <td style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', minHeight: 48 }}>
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className="sh-btn-primary hover-scale"
                            style={{ padding: '6px 12px', fontSize: 13 }}
                            disabled={updateMutation.isPending}
                            onClick={() => {
                              updateMutation.mutate(
                                { id: location.id, payload: editForm },
                                { onSuccess: () => setEditingLocationId(null) },
                              )
                            }}
                          >
                            {updateMutation.isPending ? 'Ukládám…' : 'Uložit'}
                          </button>
                          <button
                            type="button"
                            className="sh-btn-secondary"
                            style={{ padding: '6px 12px', fontSize: 13 }}
                            disabled={updateMutation.isPending}
                            onClick={() => {
                              setEditingLocationId(null)
                              setEditForm(EMPTY_FORM)
                            }}
                          >
                            Zrušit
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="hover-scale"
                            style={{ background: 'transparent', border: 'none', color: 'var(--sh-teal)', cursor: 'pointer', fontSize: 13, fontWeight: 500, padding: '6px 8px' }}
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
                            Upravit
                          </button>
                          <button
                            type="button"
                            className="hover-scale"
                            style={{ background: 'transparent', border: 'none', color: 'var(--sh-red)', cursor: 'pointer', fontSize: 13, fontWeight: 500, padding: '6px 8px' }}
                            onClick={() => setDeleteTarget(location)}
                          >
                            Smazat
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="delete-location-dialog"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(2px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div style={{ background: 'var(--sh-surface)', padding: 24, borderRadius: 'var(--sh-radius-xl)', width: '100%', maxWidth: 400, boxShadow: 'var(--sh-shadow-lg)', border: '1px solid var(--sh-border)' }}>
            <h3 className="text-h3" style={{ marginTop: 0, color: 'var(--sh-red)' }}>Smazat umístění</h3>
            <p className="text-p" style={{ marginBottom: 24 }}>
              Opravdu smazat <strong>{deleteTarget.room}</strong> / {deleteTarget.furniture} / {deleteTarget.shelf}?
              Tato akce nesmaže knihy v tomto umístění, ale ztratí informaci o jejich uložení.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="sh-btn-secondary hover-scale" type="button" onClick={() => setDeleteTarget(null)}>
                Zrušit
              </button>
              <button
                type="button"
                className="hover-scale"
                style={{ background: 'var(--sh-red)', color: 'white', border: 'none', padding: '10px 16px', borderRadius: 'var(--sh-radius-md)', fontWeight: 500, cursor: 'pointer' }}
                disabled={deleteMutation.isPending}
                onClick={() => {
                  deleteMutation.mutate(deleteTarget.id, {
                    onSuccess: () => setDeleteTarget(null),
                  })
                }}
              >
                {deleteMutation.isPending ? 'Mažu…' : 'Smazat navždy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
