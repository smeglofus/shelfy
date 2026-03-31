import { useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Modal } from '../components/Modal'
import { SkeletonLocationTableRow } from '../components/Skeleton'
import { useCreateLocation, useDeleteLocation, useLocations, useUpdateLocation } from '../hooks/useLocations'
import { formatApiError } from '../lib/api'
import { useToastStore } from '../lib/toast-store'
import type { Location } from '../lib/types'

interface LocationFormValues {
  room: string
  furniture: string
  shelf: string
  display_order: string
}

const EMPTY_FORM: LocationFormValues = {
  room: '',
  furniture: '',
  shelf: '',
  display_order: '',
}

export function LocationsPage() {
  const { t } = useTranslation()
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
      const roomCmp = a.room.localeCompare(b.room, undefined, { sensitivity: 'base' })
      if (roomCmp !== 0) return roomCmp
      const furnCmp = a.furniture.localeCompare(b.furniture, undefined, { sensitivity: 'base' })
      if (furnCmp !== 0) return furnCmp
      const orderCmp = (a.display_order ?? 0) - (b.display_order ?? 0)
      if (orderCmp !== 0) return orderCmp
      return a.shelf.localeCompare(b.shelf, undefined, { numeric: true })
    })
  }, [locationsQuery.data])

  const roomSuggestions = useMemo(
    () => [...new Set((locationsQuery.data ?? []).map((l) => l.room))].sort((a, b) => a.localeCompare(b)),
    [locationsQuery.data],
  )

  const furnitureSuggestions = useMemo(
    () => [...new Set((locationsQuery.data ?? [])
      .filter((l) => !createForm.room || l.room.toLowerCase() === createForm.room.toLowerCase())
      .map((l) => l.furniture))].sort((a, b) => a.localeCompare(b)),
    [locationsQuery.data, createForm.room],
  )

  return (
    <section className="container md-max-w-3xl sh-page-enter" style={{ paddingTop: 24, paddingBottom: 40, margin: '0 auto', width: '100%' }}>
      <h2 className="text-h2" style={{ marginBottom: 4 }}>{t('locations.title')}</h2>
      <p className="text-p" style={{ color: 'var(--sh-text-muted)', marginBottom: 24 }}>{t('locations.description')}</p>

      <div style={{ background: 'var(--sh-surface)', padding: 20, borderRadius: 'var(--sh-radius-lg)', border: '1px solid var(--sh-border)', marginBottom: 32, boxShadow: 'var(--sh-shadow-sm)' }}>
        <h3 className="text-h3" style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>{t('locations.add_title')}</h3>
        <form
          aria-label="create-location-form"
          onSubmit={(event) => {
            event.preventDefault()
            createMutation.mutate({
              ...createForm,
              display_order: createForm.display_order.trim() ? Number(createForm.display_order) : null,
            }, {
              onSuccess: () => setCreateForm(EMPTY_FORM),
            })
          }}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, alignItems: 'end' }}
        >
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 6 }}>{t('locations.room')}</label>
            <input
              className="sh-input"
              aria-label={t('locations.room')}
              required
              list="location-room-suggestions"
              placeholder={t('locations.room_placeholder')}
              value={createForm.room}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, room: event.target.value }))}
            />
            <datalist id="location-room-suggestions">
              {roomSuggestions.map((room) => (
                <option key={room} value={room} />
              ))}
            </datalist>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 6 }}>{t('locations.furniture')}</label>
            <input
              className="sh-input"
              aria-label={t('locations.furniture')}
              required
              list="location-furniture-suggestions"
              placeholder={t('locations.furniture_placeholder')}
              value={createForm.furniture}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, furniture: event.target.value }))}
            />
            <datalist id="location-furniture-suggestions">
              {furnitureSuggestions.map((furniture) => (
                <option key={furniture} value={furniture} />
              ))}
            </datalist>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 6 }}>{t('locations.shelf')}</label>
            <input
              className="sh-input"
              aria-label={t('locations.shelf')}
              required
              placeholder={t('locations.shelf_placeholder')}
              value={createForm.shelf}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, shelf: event.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 6 }}>{t('locations.display_order', 'Pořadí police')}</label>
            <input
              className="sh-input"
              aria-label={t('locations.display_order', 'Pořadí police')}
              placeholder={t('locations.display_order_placeholder', 'auto')}
              value={createForm.display_order}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, display_order: event.target.value.replace(/[^0-9]/g, '') }))}
            />
          </div>
          <button type="submit" className="sh-btn-primary hover-scale" disabled={createMutation.isPending} style={{ padding: '12px 16px' }}>
            {createMutation.isPending ? t('locations.creating') : t('locations.create')}
          </button>
        </form>
      </div>

      {locationsQuery.isLoading && (
        <div style={{ borderRadius: 'var(--sh-radius-lg)', border: '1px solid var(--sh-border)', overflow: 'hidden', background: 'var(--sh-surface)' }}>
          <table width="100%" cellPadding={16} style={{ borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
            <thead style={{ background: 'var(--sh-surface-elevated)', borderBottom: '1px solid var(--sh-border)' }}>
              <tr>
                <th style={{ fontWeight: 600, color: 'var(--sh-text-muted)', whiteSpace: 'nowrap' }}>{t('locations.room')}</th>
                <th style={{ fontWeight: 600, color: 'var(--sh-text-muted)', whiteSpace: 'nowrap' }}>{t('locations.furniture')}</th>
                <th style={{ fontWeight: 600, color: 'var(--sh-text-muted)', whiteSpace: 'nowrap' }}>{t('locations.shelf')}</th>
                <th style={{ fontWeight: 600, color: 'var(--sh-text-muted)', whiteSpace: 'nowrap' }}>{t('locations.display_order', 'Pořadí')}</th>
                <th style={{ fontWeight: 600, color: 'var(--sh-text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>{t('locations.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonLocationTableRow key={i} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {locationsQuery.isError && (
        <div style={{ padding: 16, background: 'var(--sh-red)', color: 'white', borderRadius: 'var(--sh-radius-md)' }}>
          <p style={{ margin: 0, marginBottom: 12 }}>{t('locations.error')}</p>
          <button
            type="button"
            className="sh-btn-secondary hover-scale"
            style={{ border: 'none', background: 'white', color: 'var(--sh-red)' }}
            onClick={() => {
              showError(formatApiError(locationsQuery.error))
              void locationsQuery.refetch()
            }}
          >
            {t('locations.retry')}
          </button>
        </div>
      )}

      {!locationsQuery.isLoading && !locationsQuery.isError && sortedLocations.length === 0 && (
        <div style={{ textAlign: 'center', padding: '64px 24px', background: 'var(--sh-surface)', borderRadius: 'var(--sh-radius-lg)', border: '1px dashed var(--sh-border-2)' }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.8 }}>🗺️</div>
          <p className="text-h3" style={{ marginBottom: 8, color: 'var(--sh-text-main)' }}>
            {t('locations.empty_title')}
          </p>
          <p className="text-p" style={{ color: 'var(--sh-text-muted)' }}>{t('locations.empty_body')}</p>
        </div>
      )}

      {/* ── Desktop table (≥768px) ──────────────────────────────── */}
      {sortedLocations.length > 0 && (
        <div className="sh-locations-desktop" style={{ borderRadius: 'var(--sh-radius-lg)', border: '1px solid var(--sh-border)', overflow: 'hidden', background: 'var(--sh-surface)' }}>
          <table className="sh-locations-table">
            <thead>
              <tr>
                <th>{t('locations.room')}</th>
                <th>{t('locations.furniture')}</th>
                <th>{t('locations.shelf')}</th>
                <th>{t('locations.display_order', 'Pořadí')}</th>
                <th style={{ textAlign: 'right' }}>{t('locations.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedLocations.map((location) => {
                const isEditing = editingLocationId === location.id

                return (
                  <tr key={location.id} style={{ background: isEditing ? 'var(--sh-surface-elevated)' : 'transparent' }}>
                    <td>{isEditing ? <input className="sh-input" aria-label={t('locations.edit_room')} value={editForm.room} onChange={(event) => setEditForm((prev) => ({ ...prev, room: event.target.value }))} /> : <span style={{ fontWeight: 500 }}>{location.room}</span>}</td>
                    <td>{isEditing ? <input className="sh-input" aria-label={t('locations.edit_furniture')} value={editForm.furniture} onChange={(event) => setEditForm((prev) => ({ ...prev, furniture: event.target.value }))} /> : <span style={{ color: 'var(--sh-text-muted)' }}>{location.furniture}</span>}</td>
                    <td>{isEditing ? <input className="sh-input" aria-label={t('locations.edit_shelf')} value={editForm.shelf} onChange={(event) => setEditForm((prev) => ({ ...prev, shelf: event.target.value }))} /> : <span style={{ color: 'var(--sh-text-muted)' }}>{location.shelf}</span>}</td>
                    <td>{isEditing ? <input className="sh-input" aria-label={t('locations.display_order', 'Pořadí police')} value={editForm.display_order} onChange={(event) => setEditForm((prev) => ({ ...prev, display_order: event.target.value.replace(/[^0-9]/g, '') }))} /> : <span style={{ color: 'var(--sh-text-muted)' }}>{location.display_order ?? 0}</span>}</td>
                    <td style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', minHeight: 48 }}>
                      {isEditing ? (
                        <>
                          <button type="button" className="sh-btn-primary" style={{ padding: '6px 12px', fontSize: 13 }} disabled={updateMutation.isPending} onClick={() => { updateMutation.mutate({ id: location.id, payload: { ...editForm, display_order: editForm.display_order.trim() ? Number(editForm.display_order) : 0 } }, { onSuccess: () => setEditingLocationId(null) }) }}>
                            {updateMutation.isPending ? t('locations.saving') : t('locations.save')}
                          </button>
                          <button type="button" className="sh-btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }} disabled={updateMutation.isPending} onClick={() => { setEditingLocationId(null); setEditForm(EMPTY_FORM) }}>
                            {t('locations.cancel')}
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" style={{ background: 'transparent', border: 'none', color: 'var(--sh-teal)', cursor: 'pointer', fontSize: 13, fontWeight: 500, padding: '6px 8px' }} disabled={updateMutation.isPending} onClick={() => { setEditingLocationId(location.id); setEditForm({ room: location.room, furniture: location.furniture, shelf: location.shelf, display_order: String(location.display_order ?? 0) }) }}>
                            {t('locations.edit')}
                          </button>
                          <button type="button" style={{ background: 'transparent', border: 'none', color: 'var(--sh-red)', cursor: 'pointer', fontSize: 13, fontWeight: 500, padding: '6px 8px' }} onClick={() => setDeleteTarget(location)}>
                            {t('locations.delete')}
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

      {/* ── Mobile card layout (<768px) ────────────────────────── */}
      {sortedLocations.length > 0 && (
        <div className="sh-locations-mobile" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sortedLocations.map((location) => {
            const isEditing = editingLocationId === location.id

            return (
              <div
                key={location.id}
                style={{
                  background: isEditing ? 'var(--sh-surface-elevated)' : 'var(--sh-surface)',
                  border: '1px solid var(--sh-border)',
                  borderRadius: 'var(--sh-radius-md)',
                  padding: 14,
                  transition: 'background 0.2s',
                }}
              >
                {isEditing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 4 }}>{t('locations.room')}</label>
                        <input className="sh-input" value={editForm.room} onChange={(e) => setEditForm((prev) => ({ ...prev, room: e.target.value }))} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 4 }}>{t('locations.furniture')}</label>
                        <input className="sh-input" value={editForm.furniture} onChange={(e) => setEditForm((prev) => ({ ...prev, furniture: e.target.value }))} />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 4 }}>{t('locations.shelf')}</label>
                        <input className="sh-input" value={editForm.shelf} onChange={(e) => setEditForm((prev) => ({ ...prev, shelf: e.target.value }))} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 4 }}>{t('locations.display_order', 'Pořadí')}</label>
                        <input className="sh-input" value={editForm.display_order} onChange={(e) => setEditForm((prev) => ({ ...prev, display_order: e.target.value.replace(/[^0-9]/g, '') }))} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="sh-btn-primary" style={{ flex: 1, padding: '8px 12px', fontSize: 13 }} disabled={updateMutation.isPending} onClick={() => { updateMutation.mutate({ id: location.id, payload: { ...editForm, display_order: editForm.display_order.trim() ? Number(editForm.display_order) : 0 } }, { onSuccess: () => setEditingLocationId(null) }) }}>
                        {updateMutation.isPending ? t('locations.saving') : t('locations.save')}
                      </button>
                      <button type="button" className="sh-btn-ghost" style={{ padding: '8px 12px', fontSize: 13 }} disabled={updateMutation.isPending} onClick={() => { setEditingLocationId(null); setEditForm(EMPTY_FORM) }}>
                        {t('locations.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2, color: 'var(--sh-text-main)' }}>{location.room}</div>
                      <div style={{ fontSize: 13, color: 'var(--sh-text-muted)' }}>
                        {location.furniture} › <span style={{ color: 'var(--sh-teal-text)', background: 'var(--sh-teal-bg)', padding: '1px 6px', borderRadius: 'var(--sh-radius-xs)', fontSize: 12 }}>{location.shelf}</span>
                      </div>
                      {(location.display_order != null && location.display_order > 0) && (
                        <div style={{ fontSize: 11, color: 'var(--sh-text-muted)', marginTop: 2 }}>#{location.display_order}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button type="button" className="sh-touch-target" style={{ background: 'transparent', border: 'none', color: 'var(--sh-teal)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }} onClick={() => { setEditingLocationId(location.id); setEditForm({ room: location.room, furniture: location.furniture, shelf: location.shelf, display_order: String(location.display_order ?? 0) }) }}>
                        {t('locations.edit')}
                      </button>
                      <button type="button" className="sh-touch-target" style={{ background: 'transparent', border: 'none', color: 'var(--sh-red)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }} onClick={() => setDeleteTarget(location)}>
                        {t('locations.delete')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} label={t('locations.delete_title')} maxWidth={400}>
        <h3 className="text-h3" style={{ marginTop: 0, color: 'var(--sh-red)' }}>{t('locations.delete_title')}</h3>
        <p className="text-p" style={{ marginBottom: 24 }}>
          {deleteTarget && (
            <Trans
              i18nKey="locations.delete_body"
              values={{ room: deleteTarget.room, furniture: deleteTarget.furniture, shelf: deleteTarget.shelf }}
              components={{ strong: <strong /> }}
            />
          )}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button className="sh-btn-secondary" type="button" onClick={() => setDeleteTarget(null)}>
            {t('locations.cancel')}
          </button>
          <button
            type="button"
            className="sh-btn-danger"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (deleteTarget) {
                deleteMutation.mutate(deleteTarget.id, {
                  onSuccess: () => setDeleteTarget(null),
                })
              }
            }}
          >
            {deleteMutation.isPending ? t('locations.deleting') : t('locations.delete_forever')}
          </button>
        </div>
      </Modal>
    </section>
  )
}
