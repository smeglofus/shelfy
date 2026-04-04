import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  useDroppable,
  DragOverlay,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { EmptyShelfIcon } from '../components/EmptyStateIcons'
import { Modal } from '../components/Modal'
import { useBooks, useBulkMoveBooks } from '../hooks/useBooks'
import { bulkReorderBooks, updateBook } from '../lib/api'
import { useToastStore } from '../lib/toast-store'
import { useLocations } from '../hooks/useLocations'
import { ROUTES, getBookDetailRoute } from '../lib/routes'
import { LocationsPage } from './LocationsPage'
import type { Book, Location } from '../lib/types'

export function BookshelfViewPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)

  const { data: locations = [] } = useLocations()
  const { data: booksData } = useBooks({ pageSize: 100 })
  const allBooks = booksData?.items ?? []

  const preselectedLocationId = searchParams.get('location_id')
  const highlightBookId = searchParams.get('highlight_book_id')
  const activeTab = searchParams.get('tab') === 'locations' ? 'locations' : 'shelves'
  const highlightSpineRef = useRef<HTMLButtonElement | null>(null)

  const [selectedRoom, setSelectedRoom] = useState<string>('')
  const [selectMode, setSelectMode] = useState(false)
  const [reorderMode, setReorderMode] = useState(false)
  const [savingReorder, setSavingReorder] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false)
  const [bulkMoveTarget, setBulkMoveTarget] = useState<string>('')
  const [bulkInsertPosition, setBulkInsertPosition] = useState('')
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [activeDragBook, setActiveDragBook] = useState<Book | null>(null)
  const [dragSnapshot, setDragSnapshot] = useState<Record<string, Book[]> | null>(null)
  const bulkMoveMutation = useBulkMoveBooks()

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const locationTree = useMemo(() => {
    const tree: Record<string, Record<string, Location[]>> = {}
    for (const loc of locations) {
      if (!tree[loc.room]) tree[loc.room] = {}
      if (!tree[loc.room][loc.furniture]) tree[loc.room][loc.furniture] = []
      tree[loc.room][loc.furniture].push(loc)
    }
    for (const room of Object.values(tree)) {
      for (const furniture of Object.keys(room)) {
        room[furniture].sort(
          (a, b) =>
            ((a.display_order ?? 0) - (b.display_order ?? 0))
            || a.shelf.localeCompare(b.shelf, undefined, { numeric: true }),
        )
      }
    }
    return tree
  }, [locations])

  const booksByLocation = useMemo(() => {
    const map: Record<string, Book[]> = {}
    for (const book of allBooks) {
      if (!book.location_id) continue
      if (!map[book.location_id]) map[book.location_id] = []
      map[book.location_id].push(book)
    }
    for (const books of Object.values(map)) {
      books.sort((a, b) => (a.shelf_position ?? 999) - (b.shelf_position ?? 999))
    }
    return map
  }, [allBooks])

  const [localByLocation, setLocalByLocation] = useState<Record<string, Book[]>>({})
  useEffect(() => setLocalByLocation(booksByLocation), [booksByLocation])

  const originalBookById = useMemo(() => {
    const map = new Map<string, { location_id: string | null; shelf_position: number | null }>()
    for (const book of allBooks) map.set(book.id, { location_id: book.location_id, shelf_position: book.shelf_position })
    return map
  }, [allBooks])

  const roomNames = Object.keys(locationTree)
  const filteredTree = selectedRoom ? { [selectedRoom]: locationTree[selectedRoom] } : locationTree

  const visibleBooks = useMemo(() => {
    const out: Book[] = []
    for (const furnitureMap of Object.values(filteredTree)) {
      for (const shelfLocations of Object.values(furnitureMap)) {
        for (const loc of shelfLocations) out.push(...(localByLocation[loc.id] ?? []))
      }
    }
    return out
  }, [filteredTree, localByLocation])

  const allVisibleSelected = visibleBooks.length > 0 && visibleBooks.every((b) => selectedIds.has(b.id))
  const visibleInTargetCount = bulkMoveTarget
    ? (localByLocation[bulkMoveTarget]?.filter((b) => !selectedIds.has(b.id)).length ?? 0)
    : visibleBooks.filter((b) => !selectedIds.has(b.id)).length

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const clearSelection = () => { setSelectedIds(new Set()); setSelectMode(false) }
  const selectAllVisible = () => { setSelectMode(true); setSelectedIds(new Set(visibleBooks.map((b) => b.id))) }

  useEffect(() => {
    if (!highlightBookId || activeTab !== 'shelves') return
    const timer = setTimeout(() => {
      highlightSpineRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }, 80)
    return () => clearTimeout(timer)
  }, [highlightBookId, activeTab, filteredTree])

  function findBookObject(id: string): Book | null {
    for (const books of Object.values(localByLocation)) {
      const found = books.find((b) => b.id === id)
      if (found) return found
    }
    return null
  }

  function findBook(id: string): { locationId: string; index: number } | null {
    for (const [locId, books] of Object.entries(localByLocation)) {
      const idx = books.findIndex((b) => b.id === id)
      if (idx >= 0) return { locationId: locId, index: idx }
    }
    return null
  }

  function onDragStart(event: DragStartEvent) {
    const id = String(event.active.id)
    setActiveDragId(id)
    setActiveDragBook(findBookObject(id) ?? allBooks.find((b) => b.id === id) ?? null)
    setDragSnapshot(localByLocation)
  }


  function onDragOver(event: DragOverEvent) {
    if (!reorderMode || selectMode) return
    const activeId = String(event.active.id)
    const overId = event.over?.id ? String(event.over.id) : null
    if (!overId || activeId === overId) return

    const from = findBook(activeId)
    if (!from) return

    let targetLocationId: string | null = null
    let targetIndex = 0

    if (overId.startsWith('shelf:')) {
      targetLocationId = overId.slice('shelf:'.length)
      targetIndex = (localByLocation[targetLocationId] ?? []).length
    } else {
      const to = findBook(overId)
      if (!to) return
      targetLocationId = to.locationId
      targetIndex = to.index
    }

    if (!targetLocationId) return

    const next = { ...localByLocation }

    if (from.locationId === targetLocationId) {
      const arr = [...next[from.locationId]]
      const fromIndex = arr.findIndex((b) => b.id === activeId)
      const toIndex = overId.startsWith('shelf:') ? arr.length - 1 : targetIndex
      if (fromIndex === toIndex) return
      next[from.locationId] = arrayMove(arr, fromIndex, Math.max(0, toIndex)).map((b, i) => ({ ...b, shelf_position: i }))
    } else {
      const fromArr = [...(next[from.locationId] ?? [])]
      const idx = fromArr.findIndex((b) => b.id === activeId)
      if (idx < 0) return
      const [moving] = fromArr.splice(idx, 1)
      const toArr = [...(next[targetLocationId] ?? [])]
      const insertAt = overId.startsWith('shelf:') ? toArr.length : Math.max(0, targetIndex)
      toArr.splice(insertAt, 0, { ...moving, location_id: targetLocationId })
      next[from.locationId] = fromArr.map((b, i) => ({ ...b, shelf_position: i }))
      next[targetLocationId] = toArr.map((b, i) => ({ ...b, shelf_position: i }))
    }

    setLocalByLocation(next)
  }

  async function persistCurrentReorder() {
    const changed: Array<{ id: string; location_id: string; shelf_position: number }> = []

    for (const [locationId, books] of Object.entries(localByLocation)) {
      books.forEach((book, index) => {
        const prev = originalBookById.get(book.id)
        if (!prev || prev.location_id !== locationId || (prev.shelf_position ?? null) !== index) {
          changed.push({ id: book.id, location_id: locationId, shelf_position: index })
        }
      })
    }

    if (changed.length === 0) return

    setSavingReorder(true)
    try {
      await bulkReorderBooks({ items: changed })
      showSuccess(t('books.reorder_saved', 'Reordering saved'))
    } catch {
      setLocalByLocation(booksByLocation)
      showError(t('books.error'))
    } finally {
      setSavingReorder(false)
    }
  }

  async function onDragEnd(event: DragEndEvent) {
    if (!reorderMode || selectMode) { setActiveDragId(null); return }
    const activeId = String(event.active.id)
    const overId = event.over?.id ? String(event.over.id) : null
    if (!overId || activeId === overId) { setActiveDragId(null); return }

    const from = findBook(activeId)
    if (!from) { setActiveDragId(null); return }

    let targetLocationId: string | null = null
    let targetIndex = 0

    if (overId.startsWith('shelf:')) {
      targetLocationId = overId.slice('shelf:'.length)
      targetIndex = (localByLocation[targetLocationId] ?? []).length
    } else {
      const to = findBook(overId)
      if (!to) { setActiveDragId(null); return }
      targetLocationId = to.locationId
      targetIndex = to.index
    }

    if (!targetLocationId) { setActiveDragId(null); return }

    const snapshot = dragSnapshot ?? localByLocation
    const next = { ...localByLocation }

    if (from.locationId === targetLocationId) {
      const arr = [...next[from.locationId]]
      const fromIndex = arr.findIndex((b) => b.id === activeId)
      const toIndex = overId.startsWith('shelf:') ? arr.length - 1 : targetIndex
      next[from.locationId] = arrayMove(arr, fromIndex, Math.max(0, toIndex)).map((b, i) => ({ ...b, shelf_position: i }))
    } else {
      const fromArr = [...(next[from.locationId] ?? [])]
      const idx = fromArr.findIndex((b) => b.id === activeId)
      if (idx < 0) return
      const [moving] = fromArr.splice(idx, 1)
      const toArr = [...(next[targetLocationId] ?? [])]
      const insertAt = overId.startsWith('shelf:') ? toArr.length : Math.max(0, targetIndex)
      toArr.splice(insertAt, 0, { ...moving, location_id: targetLocationId })
      next[from.locationId] = fromArr.map((b, i) => ({ ...b, shelf_position: i }))
      next[targetLocationId] = toArr.map((b, i) => ({ ...b, shelf_position: i }))
    }

    setLocalByLocation(next)

    try {
      await updateBook(activeId, {
        location_id: targetLocationId,
        shelf_position: overId.startsWith('shelf:') ? ((next[targetLocationId]?.length ?? 1) - 1) : targetIndex,
      })
    } catch (e) {
      setLocalByLocation(snapshot)
      showError(t('books.error'))
    } finally {
      setActiveDragId(null)
    }
  }

  return (
    <div className="container" style={{ margin: '0 auto', width: '100%', maxWidth: 960 }}>
      <div className="sh-page-header">
        <button onClick={() => navigate(ROUTES.books)} className="sh-back-btn hover-lift">←</button>
        <h2 className="text-h2" style={{ marginBottom: 0 }}>{t('bookshelf.title')}</h2>
        <div style={{ flex: 1 }} />
        {activeTab === 'shelves' && visibleBooks.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => {
                const next = !selectMode
                setSelectMode(next)
                if (next) setReorderMode(false)
                if (!next) setSelectedIds(new Set())
              }}
              className="sh-btn-secondary"
              style={{ marginRight: 8 }}
            >
              {selectMode ? t('bulk.deselect_all') : t('bulk.select_mode', 'Select')}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (reorderMode) {
                  await persistCurrentReorder()
                  setReorderMode(false)
                  return
                }
                setReorderMode(true)
                clearSelection()
              }}
              className="sh-btn-secondary"
              disabled={savingReorder}
              style={{ marginRight: 8, borderColor: reorderMode ? 'var(--sh-primary)' : undefined, opacity: savingReorder ? 0.7 : 1 }}
            >
              {savingReorder ? t('books.saving', 'Saving...') : (reorderMode ? t('books.reorder_done', 'Done reordering') : t('books.reorder_mode', 'Reorder'))}
            </button>
          </>
        )}
        <button onClick={() => navigate(ROUTES.scanShelf)} className="sh-btn-primary hover-scale" style={{ padding: '10px 20px', fontSize: 14 }}>
          + {t('bookshelf.scan_shelf')}
        </button>
      </div>

      <div className="sh-underline-tabs" style={{ marginBottom: 24 }}>
        <button type='button' className={`sh-underline-tab${activeTab === 'shelves' ? ' sh-underline-tab--active' : ''}`} onClick={() => navigate(ROUTES.bookshelfView)}>{t('bookshelf.tab_shelves')}</button>
        <button type='button' className={`sh-underline-tab${activeTab === 'locations' ? ' sh-underline-tab--active' : ''}`} onClick={() => navigate(`${ROUTES.bookshelfView}?tab=locations`)}>{t('bookshelf.tab_locations')}</button>
      </div>

      {activeTab === 'locations' ? (
        <LocationsPage />
      ) : (<>
        {roomNames.length > 1 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
            <button onClick={() => setSelectedRoom('')} className={`sh-pill${!selectedRoom ? ' sh-pill--active' : ''}`} style={{ padding: '8px 16px', fontSize: 13 }}>{t('tabs.all')}</button>
            {roomNames.map(room => (
              <button key={room} onClick={() => setSelectedRoom(room)} className={`sh-pill${selectedRoom === room ? ' sh-pill--active' : ''}`} style={{ padding: '8px 16px', fontSize: 13 }}>{room}</button>
            ))}
          </div>
        )}

        {selectMode && selectedIds.size === 0 && (
          <div style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--sh-text-muted)' }}>
            {t('bulk.select_mode_hint', 'Select mode active — click books to select them')}
          </div>
        )}
        {reorderMode && (
          <div style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--sh-text-muted)' }}>
            {t('books.reorder_hint', 'Drag books to reorder. On touch devices, long-press to start drag.')}
          </div>
        )}

        {Object.keys(filteredTree).length === 0 && (
          <div className="sh-empty-state" style={{ padding: 60 }}>
            <div className="sh-empty-state__icon"><EmptyShelfIcon size={56} /></div>
            <h3 className="text-h3">{t('bookshelf.empty_title')}</h3>
            <p className="text-small">{t('bookshelf.empty_desc')}</p>
          </div>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { if (dragSnapshot) setLocalByLocation(dragSnapshot); setActiveDragId(null); setActiveDragBook(null); setDragSnapshot(null) }}>
          {Object.entries(filteredTree).map(([room, furnitureMap]) => (
            <div key={room} style={{ marginBottom: 40 }}>
              <h3 className="text-h3" style={{ marginBottom: 16, color: 'var(--sh-text-main)' }}>{room}</h3>

              {Object.entries(furnitureMap).map(([furniture, shelfLocations]) => (
                <div key={furniture} className="sh-card-panel" style={{ marginBottom: 24, borderRadius: 'var(--sh-radius-lg)', overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sh-border)', background: 'var(--sh-bg)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>📖</span>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{furniture}</span>
                  </div>

                  {shelfLocations.map((loc) => {
                    const shelfBooks = localByLocation[loc.id] ?? []
                    const isHighlighted = preselectedLocationId === loc.id

                    return (
                      <div key={loc.id} style={{ borderBottom: '1px solid var(--sh-border)', padding: '12px 16px', background: isHighlighted ? 'var(--sh-teal-bg)' : undefined, transition: 'background 0.3s' }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--sh-text-muted)', marginBottom: 8 }}>{loc.shelf}</div>

                        {shelfBooks.length === 0 ? (
                          <div style={{ fontSize: 12, color: 'var(--sh-text-muted)', fontStyle: 'italic', padding: '8px 0' }}>{t('bookshelf.empty_shelf')}</div>
                        ) : (
                          <SortableContext items={shelfBooks.map((b) => b.id)} strategy={horizontalListSortingStrategy}>
                            <DroppableShelfRow shelfId={loc.id}>
                              {shelfBooks.map((book) => (
                                <SortableBookSpine
                                  key={book.id}
                                  id={book.id}
                                  reorderMode={reorderMode && !selectMode}
                                  book={book}
                                  highlighted={highlightBookId === book.id}
                                  selected={selectedIds.has(book.id)}
                                  focusRef={highlightBookId === book.id ? highlightSpineRef : undefined}
                                  onClick={() => (selectMode ? toggleSelect(book.id) : (reorderMode ? undefined : navigate(getBookDetailRoute(book.id))))}
                                />
                              ))}
                            </DroppableShelfRow>
                          </SortableContext>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          ))}

          {createPortal(
            <DragOverlay adjustScale={false} zIndex={12000}>
              {activeDragBook ? (
                <div style={{ pointerEvents: 'none', transform: 'rotate(1deg)', opacity: 0.98 }}>
                  <BookSpine
                    book={activeDragBook}
                    onClick={() => {}}
                    highlighted={false}
                    selected={false}
                  />
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )}
        </DndContext>

        <div style={{ height: 80 }} />

        {activeTab === 'shelves' && selectMode && (
          <div className="sh-bulk-toolbar" role="toolbar" aria-label="Bookshelf bulk actions">
            <span className="sh-bulk-toolbar__label">{t('bulk.selected', { count: selectedIds.size })}</span>
            <button type="button" className="sh-bulk-toolbar__btn" onClick={allVisibleSelected ? () => setSelectedIds(new Set()) : selectAllVisible}>
              {allVisibleSelected ? t('bulk.deselect_all') : t('bulk.select_all')}
            </button>
            <button type="button" className="sh-bulk-toolbar__btn" onClick={() => { setBulkMoveTarget(''); setBulkInsertPosition(''); setBulkMoveOpen(true) }} disabled={selectedIds.size === 0}>
              {t('bulk.move', { count: selectedIds.size })}
            </button>
            <button type="button" className="sh-bulk-toolbar__close" onClick={clearSelection} aria-label="Close">×</button>
          </div>
        )}

        <Modal open={bulkMoveOpen} onClose={() => setBulkMoveOpen(false)} size="sm" label={t('bulk.move_to')}>
          <h3 className="text-h3" style={{ marginTop: 0 }}>{t('bulk.move_to')}</h3>
          <label className="sh-form-label" style={{ marginTop: 12 }}>{t('bulk.move_to')}</label>
          <select className="sh-select" value={bulkMoveTarget} onChange={(e) => setBulkMoveTarget(e.target.value)} style={{ marginBottom: 12 }}>
            <option value="">{t('bulk.no_location')}</option>
            {locations.map((loc) => (<option key={loc.id} value={loc.id}>{loc.room} / {loc.furniture} / {loc.shelf}</option>))}
          </select>

          <label className="sh-form-label">{t('bulk.insert_position_label', 'Insert at position')}</label>
          <input className="sh-input" inputMode="numeric" placeholder={t('bulk.insert_position_placeholder', 'leave empty = append to end')} value={bulkInsertPosition} onChange={(e) => setBulkInsertPosition(e.target.value.replace(/\D/g, ''))} style={{ marginBottom: 8 }} />
          <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--sh-text-muted)' }}>
            {t('bulk.insert_position_max', { max: visibleInTargetCount })}
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button onClick={() => setBulkMoveOpen(false)} className="sh-btn-secondary">{t('books.delete_cancel')}</button>
            <button
              onClick={() => {
                bulkMoveMutation.mutate({
                  ids: [...selectedIds],
                  location_id: bulkMoveTarget || null,
                  insert_position: bulkInsertPosition === '' ? null : Number(bulkInsertPosition),
                }, { onSuccess: () => { setBulkMoveOpen(false); clearSelection() } })
              }}
              className="sh-btn-primary"
              disabled={bulkMoveMutation.isPending || selectedIds.size === 0}
            >
              {bulkMoveMutation.isPending ? '…' : t('bulk.move', { count: selectedIds.size })}
            </button>
          </div>
        </Modal>
      </>)}
    </div>
  )
}


function DroppableShelfRow({ shelfId, children }: { shelfId: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `shelf:${shelfId}` })
  return (
    <div
      ref={setNodeRef}
      style={{
        display: 'flex',
        gap: 5,
        overflowX: 'auto',
        paddingBottom: 0,
        paddingTop: 4,
        alignItems: 'flex-end',
        borderBottom: '3px solid var(--sh-border-2)',
        backgroundImage: 'linear-gradient(to top, var(--sh-surface-elevated) 3px, transparent 3px)',
        boxShadow: isOver ? 'inset 0 0 0 2px var(--sh-border-focus)' : undefined,
      }}
    >
      {children}
    </div>
  )
}

function SortableBookSpine({
  id,
  reorderMode,
  ...props
}: {
  id: string
  reorderMode: boolean
  book: Book
  onClick: () => void
  highlighted?: boolean
  selected?: boolean
  focusRef?: RefObject<HTMLButtonElement | null>
}) {
  const sortable = useSortable({ id, disabled: !reorderMode })
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.72 : 1,
  }

  return (
    <div ref={sortable.setNodeRef} style={style}>
      <BookSpine
        {...props}
        draggableProps={reorderMode ? { ...sortable.attributes, ...sortable.listeners } : undefined}
      />
    </div>
  )
}

function BookSpine({
  book,
  onClick,
  highlighted = false,
  focusRef,
  selected = false,
  draggableProps,
}: {
  book: Book
  onClick: () => void
  highlighted?: boolean
  focusRef?: RefObject<HTMLButtonElement | null>
  selected?: boolean
  draggableProps?: Record<string, unknown>
}) {
  const hasCover = Boolean(book.cover_image_url)

  const color = useMemo(() => {
    const colors = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2', '#4f46e5', '#be185d', '#0d9488', '#6d28d9', '#c2410c', '#0369a1']
    let hash = 0
    for (let i = 0; i < book.title.length; i++) hash = book.title.charCodeAt(i) + ((hash << 5) - hash)
    return colors[Math.abs(hash) % colors.length]
  }, [book.title])

  const displayTitle = book.title.length > 40 ? `${book.title.slice(0, 38)}…` : book.title

  return (
    <button
      ref={focusRef}
      onClick={onClick}
      className="sh-book-spine"
      title={`${book.title}${book.author ? ` — ${book.author}` : ''}`}
      data-highlighted={highlighted ? '' : undefined}
      style={{
        minWidth: 44,
        maxWidth: 56,
        height: 150,
        background: hasCover ? 'var(--sh-surface)' : color,
        borderRadius: '2px 3px 3px 2px',
        border: selected ? '2px solid var(--sh-primary)' : (highlighted ? '2px solid var(--sh-teal)' : (hasCover ? '1px solid var(--sh-border)' : 'none')),
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: hasCover ? 0 : '6px 3px',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: highlighted
          ? '0 0 0 3px var(--sh-border-focus), 2px 4px 10px rgba(0,0,0,0.2)'
          : '1px 1px 3px rgba(0,0,0,0.12), inset -1px 0 2px rgba(0,0,0,0.08)',
        flexShrink: 0,
      }}
      {...(draggableProps ?? {})}
    >
      <span style={{ position: 'absolute', top: 2, left: 4, fontSize: 10, fontWeight: 700, color: hasCover ? 'white' : 'rgba(255,255,255,0.9)', textShadow: '0 1px 2px rgba(0,0,0,0.45)', zIndex: 2 }}>#{(book.shelf_position ?? 0) + 1}</span>
      {hasCover ? (
        <img src={book.cover_image_url ?? ''} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading='lazy' />
      ) : (
        <span style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', color: 'white', fontSize: 10, fontWeight: 600, lineHeight: 1.15, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', maxHeight: '100%', letterSpacing: '0.01em', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
          {displayTitle}
        </span>
      )}
    </button>
  )
}
