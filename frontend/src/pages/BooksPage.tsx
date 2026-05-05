import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { BookCard } from '../components/BookCard'
import { EmptyLibraryIcon, NoResultsIcon } from '../components/EmptyStateIcons'
import { Modal } from '../components/Modal'
import { FirstBookOnboardingModal } from '../components/OnboardingWizard'
import { ShelfBreadcrumb } from '../components/ShelfBreadcrumb'
import { SkeletonBookGrid } from '../components/Skeleton'
import { StatBar } from '../components/StatBar'
import { useBulkDeleteBooks, useBulkMoveBooks, useBulkUpdateStatus, useBooksForShelf, useDeleteBook, useJobStatus } from '../hooks/useBooks'
import { useDebounce } from '../hooks/useDebounce'
import { useLocations } from '../hooks/useLocations'
import { useOnboardingStatus } from '../hooks/useOnboarding'
import { useToastStore } from '../lib/toast-store'
import { ROUTES } from '../lib/routes'
import type { Book, Location, ReadingStatus } from '../lib/types'

type StatFilter = 'total' | 'read' | 'reading' | 'lent'

export function BooksPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebounce(searchInput.trim(), 300)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [uploadJobId, setUploadJobId] = useState<string | null>(null)
  const [readingFilter, setReadingFilter] = useState<ReadingStatus | null>(null)
  const [locationFilter, setLocationFilter] = useState<string>('all')
  const [statFilter, setStatFilter] = useState<StatFilter>('total')

  // Onboarding
  const onboardingQuery = useOnboardingStatus()
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => localStorage.getItem('shelfy_onboarding_dismissed') === '1',
  )

  // Advanced filters
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [languageInput, setLanguageInput] = useState('')
  const [publisherInput, setPublisherInput] = useState('')
  const [yearFromInput, setYearFromInput] = useState('')
  const [yearToInput, setYearToInput] = useState('')
  const debouncedLanguage = useDebounce(languageInput.trim(), 400)
  const debouncedPublisher = useDebounce(publisherInput.trim(), 400)
  const toastedFailedIdsRef = useRef<Set<string>>(new Set())

  const tabItems: { label: string; value: ReadingStatus | null }[] = useMemo(
    () => [
      { label: t('tabs.all'), value: null },
      { label: t('tabs.reading'), value: 'reading' },
      { label: t('tabs.read'), value: 'read' },
      { label: t('tabs.unread'), value: 'unread' },
    ],
    [t],
  )

  const activeAdvancedCount = (debouncedLanguage ? 1 : 0) + (debouncedPublisher ? 1 : 0) + (yearFromInput || yearToInput ? 1 : 0)


  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false)
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false)
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false)
  const [bulkMoveTarget, setBulkMoveTarget] = useState<string>('')
  const [bulkInsertPosition, setBulkInsertPosition] = useState('')
  const [bulkStatusTarget, setBulkStatusTarget] = useState<ReadingStatus>('read')

  const isSelectMode = selectMode

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const selectAll = () => { setSelectMode(true); setSelectedIds(new Set(books.map((b) => b.id))) }
  const clearSelection = () => { setSelectedIds(new Set()); setSelectMode(false) }

  const booksQuery = useBooksForShelf()
  const locationsQuery = useLocations()

  const deleteMutation = useDeleteBook()
  const bulkDeleteMutation = useBulkDeleteBooks()
  const bulkMoveMutation = useBulkMoveBooks()
  const bulkStatusMutation = useBulkUpdateStatus()
  const uploadJobStatusQuery = useJobStatus(uploadJobId)
  const showError = useToastStore((s) => s.showError)

  const locationById = useMemo(() => {
    const m = new Map<string, Location>()
    for (const loc of locationsQuery.data ?? []) m.set(loc.id, loc)
    return m
  }, [locationsQuery.data])

  useEffect(() => {
    const failed = (booksQuery.data ?? []).filter(
      (b) => b.processing_status === 'failed' && !toastedFailedIdsRef.current.has(b.id),
    )
    if (!failed.length) return
    for (const b of failed) toastedFailedIdsRef.current.add(b.id)
    showError(
      t('books.processing_failed_bulk', {
        count: failed.length,
        titles: failed.map((b) => `"${b.title}"`).join(', '),
      }),
    )
  }, [booksQuery.data?.items, showError, t])

  useEffect(() => {
    const status = uploadJobStatusQuery.data?.status
    if (status === 'done' || status === 'failed') {
      if (status === 'failed') showError(uploadJobStatusQuery.data?.error_message ?? t('books.processing_failed'))
      setUploadJobId(null)
      void booksQuery.refetch()
    }
    if (uploadJobStatusQuery.isError) {
      showError(t('books.processing_status_check_failed'))
    }
  }, [
    booksQuery,
    showError,
    t,
    uploadJobStatusQuery.data?.error_message,
    uploadJobStatusQuery.data?.status,
    uploadJobStatusQuery.isError,
  ])

  const books = useMemo(() => {
    const all = booksQuery.data ?? []
    const q = debouncedSearch.toLowerCase()

    let raw = all.filter((b) => {
      if (readingFilter && b.reading_status !== readingFilter) return false
      if (locationFilter === 'unassigned' && b.location_id !== null) return false
      if (locationFilter !== 'all' && locationFilter !== 'unassigned' && b.location_id !== locationFilter) return false
      if (debouncedLanguage && (b.language ?? '').toLowerCase() !== debouncedLanguage.toLowerCase()) return false
      if (debouncedPublisher && !(b.publisher ?? '').toLowerCase().includes(debouncedPublisher.toLowerCase())) return false
      if (yearFromInput && (b.published_year ?? 0) < Number(yearFromInput)) return false
      if (yearToInput && (b.published_year ?? 9999) > Number(yearToInput)) return false
      if (q) {
        const hay = `${b.title} ${b.author ?? ''} ${b.isbn ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    if (statFilter === 'lent') {
      raw = raw.filter((book) => !!book.is_currently_lent)
    }

    raw.sort((a, b) => {
      const la = a.location_id ? locationById.get(a.location_id) : null
      const lb = b.location_id ? locationById.get(b.location_id) : null
      const ka = la ? `${la.room}${la.furniture}${la.shelf}` : '￿'
      const kb = lb ? `${lb.room}${lb.furniture}${lb.shelf}` : '￿'
      if (ka < kb) return -1
      if (ka > kb) return 1
      const pa = a.shelf_position ?? Number.MAX_SAFE_INTEGER
      const pb = b.shelf_position ?? Number.MAX_SAFE_INTEGER
      if (pa !== pb) return pa - pb
      return a.title.localeCompare(b.title)
    })

    return raw
  }, [
    booksQuery.data,
    debouncedSearch,
    readingFilter,
    locationFilter,
    debouncedLanguage,
    debouncedPublisher,
    yearFromInput,
    yearToInput,
    statFilter,
    locationById,
  ])

  const moveTargetMaxPosition = useMemo(() => {
    if (!bulkMoveTarget) return books.length
    return books.filter((b) => b.location_id === bulkMoveTarget && !selectedIds.has(b.id)).length
  }, [bulkMoveTarget, books, selectedIds])

  const allVisibleSelected = books.length > 0 && selectedIds.size === books.length

  const groups = useMemo(() => {
    const map = new Map<string | null, Book[]>()
    for (const b of books) {
      const key = b.location_id ?? null
      if (!map.has(key)) map.set(key, [])
      map.get(key)?.push(b)
    }
    return map
  }, [books])

  const total = books.length
  // rawCount is the unfiltered library size — used to distinguish "library is
  // truly empty" (rawCount === 0) from "filters produced no results" (total === 0).
  const rawCount = (booksQuery.data ?? []).length

  const booksCountLabel = t('books.books_count')

  return (
    <div className="md-max-w-4xl sh-page-enter" style={{ margin: '0 auto', width: '100%' }}>
      <div style={{ padding: '24px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p className="text-small" style={{ color: 'var(--sh-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('books.title')}</p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="text-display">{total}</span>
            <span className="text-h3" style={{ color: 'var(--sh-text-muted)', margin: 0, fontWeight: 400 }}>{booksCountLabel}</span>
          </div>
        </div>
        {total > 0 && (
          <button
            type="button"
            onClick={isSelectMode ? clearSelection : () => setSelectMode(true)}
            style={{
              marginTop: 8,
              background: isSelectMode ? 'var(--sh-primary-bg)' : 'none',
              border: '1px solid var(--sh-border)',
              borderRadius: 'var(--sh-radius-md)',
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              color: isSelectMode ? 'var(--sh-primary)' : 'var(--sh-text-muted)',
              transition: 'all var(--sh-duration-fast) ease',
            }}
          >
            {isSelectMode ? t('bulk.deselect_all') : t('bulk.select_mode', 'Select')}
          </button>
        )}
      </div>

      <div style={{ padding: '0 8px' }}>
        <StatBar
          books={books}
          total={total}
          active={statFilter}
          onSelect={(key) => {
            setStatFilter(key)
            if (key === 'read') setReadingFilter('read')
            else if (key === 'reading') setReadingFilter('reading')
            else setReadingFilter(null)
          }}
        />
      </div>

      <div className="sh-underline-tabs" style={{ overflowX: 'auto', margin: '16px 24px 0', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {tabItems.map((tab) => {
          const isActive = readingFilter === tab.value
          return (
            <button
              key={tab.label}
              type="button"
              onClick={() => {
                setReadingFilter(tab.value)
                setStatFilter(tab.value === 'read' ? 'read' : tab.value === 'reading' ? 'reading' : 'total')
                  }}
              className={`sh-underline-tab${isActive ? ' sh-underline-tab--active' : ''}`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="sh-search-bar" style={{ margin: '20px 24px 0' }}>
        <span style={{ fontSize: 18, color: 'var(--sh-text-muted)' }}>⌕</span>
        <input
          aria-label={t('books.search_label')}
          placeholder={t('books.search_placeholder')}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="sh-search-bar__input"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => setSearchInput('')}
            aria-label={t('books.search_clear', 'Vymazat hledání')}
            className="sh-search-bar__clear"
          >
            ✕
          </button>
        )}
      </div>

      {isSelectMode && selectedIds.size === 0 && (
        <div style={{ margin: '10px 24px 0', fontSize: 13, color: 'var(--sh-text-muted)' }}>
          {t('bulk.select_mode_hint', 'Select mode active — click books to select them')}
        </div>
      )}

      {/* ── Advanced filters toggle ── */}
      <div style={{ margin: '8px 24px 0', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: '1px solid var(--sh-border)',
            borderRadius: 'var(--sh-radius-md)', padding: '5px 12px',
            fontSize: 13, fontWeight: 500, cursor: 'pointer',
            color: activeAdvancedCount > 0 ? 'var(--sh-primary)' : 'var(--sh-text-muted)',
            transition: 'border-color var(--sh-duration-fast) ease',
          }}
        >
          <span>{t('books.filters_toggle')}</span>
          {activeAdvancedCount > 0 && <span className="sh-filter-count">{activeAdvancedCount}</span>}
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ transition: `transform var(--sh-duration-fast) ease`, transform: advancedOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>

        <select
          className="sh-select"
          value={locationFilter}
          onChange={(event) => { setLocationFilter(event.target.value) }}
          style={{ minWidth: 200 }}
        >
          <option value="all">{t('books.filter_all_locations')}</option>
          <option value="unassigned">{t('books.filter_unassigned')}</option>
          {(locationsQuery.data ?? []).map((location) => (
            <option key={location.id} value={location.id}>
              {location.room} / {location.furniture} / {location.shelf}
            </option>
          ))}
        </select>
      </div>

      {/* ── Advanced filter panel (collapsible) ── */}
      <div style={{ overflow: 'hidden', maxHeight: advancedOpen ? 180 : 0, transition: `max-height var(--sh-duration-normal) var(--sh-ease-default), opacity var(--sh-duration-normal) ease`, opacity: advancedOpen ? 1 : 0 }}>
        <div style={{ margin: '8px 24px 0', padding: '14px 16px', background: 'var(--sh-surface-elevated)', border: '1px solid var(--sh-border)', borderRadius: 'var(--sh-radius-md)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, alignItems: 'end' }}>
            <div>
              <label className="sh-form-label sh-form-label--sm">{t('books.filter_language_label')}</label>
              <input
                className="sh-input"
                placeholder={t('books.filter_language_placeholder')}
                value={languageInput}
                onChange={(e) => { setLanguageInput(e.target.value) }}
              />
            </div>
            <div>
              <label className="sh-form-label sh-form-label--sm">{t('books.filter_publisher_label')}</label>
              <input
                className="sh-input"
                placeholder={t('books.filter_publisher_placeholder')}
                value={publisherInput}
                onChange={(e) => { setPublisherInput(e.target.value) }}
              />
            </div>
            <div>
              <label className="sh-form-label sh-form-label--sm">{t('books.filter_year_label')}</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  className="sh-input"
                  inputMode="numeric"
                  placeholder={t('books.filter_year_from')}
                  value={yearFromInput}
                  onChange={(e) => { setYearFromInput(e.target.value.replace(/\D/g, '')) }}
                  style={{ width: 72 }}
                />
                <span style={{ color: 'var(--sh-text-muted)', fontSize: 14 }}>–</span>
                <input
                  className="sh-input"
                  inputMode="numeric"
                  placeholder={t('books.filter_year_to')}
                  value={yearToInput}
                  onChange={(e) => { setYearToInput(e.target.value.replace(/\D/g, '')) }}
                  style={{ width: 72 }}
                />
              </div>
            </div>
          </div>
          {activeAdvancedCount > 0 && (
            <button
              type="button"
              onClick={() => { setLanguageInput(''); setPublisherInput(''); setYearFromInput(''); setYearToInput('') }}
              style={{ marginTop: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--sh-danger)', padding: '2px 0', fontWeight: 500 }}
            >
              {t('books.filter_clear_all')}
            </button>
          )}
        </div>
      </div>

      {/* ── Active filter chips ── */}
      {activeAdvancedCount > 0 && (
        <div style={{ margin: '8px 24px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {debouncedLanguage && (
            <button type="button" className="sh-filter-chip" onClick={() => { setLanguageInput('') }}>
              {t('books.filter_chip_language', { value: debouncedLanguage })} ×
            </button>
          )}
          {debouncedPublisher && (
            <button type="button" className="sh-filter-chip" onClick={() => { setPublisherInput('') }}>
              {t('books.filter_chip_publisher', { value: debouncedPublisher })} ×
            </button>
          )}
          {(yearFromInput || yearToInput) && (
            <button type="button" className="sh-filter-chip" onClick={() => { setYearFromInput(''); setYearToInput('') }}>
              {t('books.filter_chip_year', { from: yearFromInput || '?', to: yearToInput || '?' })} ×
            </button>
          )}
        </div>
      )}

      {uploadJobId && (
        <p style={{ margin: '16px 24px', fontSize: 14, color: 'var(--sh-amber)', fontWeight: 500, background: 'var(--sh-amber-bg)', padding: '12px 16px', borderRadius: 'var(--sh-radius-md)' }}>
          {t('books.processing_banner', { status: uploadJobStatusQuery.data?.status ?? 'pending' })}
        </p>
      )}

      <div style={{ padding: '24px 24px 0' }}>
        {booksQuery.isLoading && <SkeletonBookGrid count={8} />}

        {booksQuery.isError && (
          <p style={{ color: 'var(--sh-red)', fontSize: 15, fontWeight: 500 }}>
            {t('books.error')}{' '}
            <button
              onClick={() => void booksQuery.refetch()}
              className="sh-btn-secondary"
              style={{ marginLeft: 12, background: 'var(--sh-red-bg)', color: 'var(--sh-red-text)' }}
            >
              {t('books.retry')}
            </button>
          </p>
        )}

        {/* ── Truly empty library: show onboarding empty state with CTAs (issue #130) ── */}
        {!booksQuery.isLoading && !booksQuery.isError && rawCount === 0 && (
          <div className="sh-empty-state" data-testid="empty-library-state">
            <div className="sh-empty-state__icon">
              <EmptyLibraryIcon size={64} />
            </div>
            <h3 className="text-h3" style={{ color: 'var(--sh-text-main)', marginTop: 0 }}>
              {t('books.empty_title')}
            </h3>
            <p className="text-p" style={{ maxWidth: 340, textAlign: 'center', marginBottom: 20 }}>
              {t('books.empty_library')}
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                type="button"
                className="sh-btn-primary"
                onClick={() => navigate(ROUTES.addBook)}
              >
                {t('books.empty_cta_add')}
              </button>
              <button
                type="button"
                className="sh-btn-secondary"
                onClick={() => navigate(ROUTES.scanShelf)}
              >
                {t('books.empty_cta_scan')}
              </button>
            </div>
            <button
              type="button"
              onClick={() => navigate(ROUTES.locations)}
              style={{
                marginTop: 14,
                background: 'none',
                border: 'none',
                fontSize: 13,
                color: 'var(--sh-text-muted)',
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: 0,
              }}
            >
              {t('books.empty_cta_location')}
            </button>
          </div>
        )}

        {/* ── Has books but search / filter produced no results ── */}
        {!booksQuery.isLoading && !booksQuery.isError && rawCount > 0 && total === 0 && (
          <div className="sh-empty-state">
            <div className="sh-empty-state__icon">
              <NoResultsIcon size={56} />
            </div>
            <p className="text-h3" style={{ color: 'var(--sh-text-main)', marginTop: 0 }}>
              {debouncedSearch
                ? t('books.empty_search', { query: debouncedSearch })
                : t('books.empty_category')}
            </p>
          </div>
        )}

        {Array.from(groups.entries()).map(([locId, groupBooks]) => {
          const loc = locId ? locationById.get(locId) : null
          return (
            <div key={locId ?? 'unassigned'} style={{ marginBottom: 32 }}>
              {loc ? (
                <div style={{ marginBottom: 16 }}><ShelfBreadcrumb location={loc} /></div>
              ) : (
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--sh-text-muted)', marginBottom: 16, borderBottom: '1px solid var(--sh-border)', paddingBottom: 8 }}>{t('books.no_location')}</p>
              )}
              <div className="sh-book-grid">
                {groupBooks.map((b, i) => (
                  <BookCard
                    key={b.id}
                    book={b}
                    onDelete={isSelectMode ? undefined : setDeleteTargetId}
                    index={i}
                    selectable={isSelectMode}
                    selected={selectedIds.has(b.id)}
                    onSelect={toggleSelect}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Bulk actions toolbar ── */}
      {isSelectMode && (
        <div className="sh-bulk-toolbar" role="toolbar" aria-label="Bulk actions">
          <span className="sh-bulk-toolbar__label">{t('bulk.selected', { count: selectedIds.size })}</span>
          <button type="button" className="sh-bulk-toolbar__btn" onClick={allVisibleSelected ? () => setSelectedIds(new Set()) : selectAll}>{allVisibleSelected ? t('bulk.deselect_all') : t('bulk.select_all')}</button>
          <button type="button" className="sh-bulk-toolbar__btn" onClick={() => setBulkStatusOpen(true)} disabled={selectedIds.size === 0}>{t('bulk.change_status', { count: selectedIds.size })}</button>
          <button type="button" className="sh-bulk-toolbar__btn" onClick={() => { setBulkMoveTarget(''); setBulkInsertPosition(''); setBulkMoveOpen(true) }} disabled={selectedIds.size === 0}>{t('bulk.move', { count: selectedIds.size })}</button>
          <button type="button" className="sh-bulk-toolbar__btn sh-bulk-toolbar__btn--danger" onClick={() => setBulkDeleteConfirmOpen(true)} disabled={selectedIds.size === 0}>{t('bulk.delete', { count: selectedIds.size })}</button>
          <button type="button" className="sh-bulk-toolbar__close" onClick={clearSelection} aria-label="Close">×</button>
        </div>
      )}

      {/* ── Bulk delete confirm ── */}
      <Modal open={bulkDeleteConfirmOpen} onClose={() => setBulkDeleteConfirmOpen(false)} size="sm" label={t('bulk.delete_confirm_title', { count: selectedIds.size })}>
        <h3 className="text-h3" style={{ marginTop: 0 }}>{t('bulk.delete_confirm_title', { count: selectedIds.size })}</h3>
        <p className="text-p" style={{ marginBottom: 24 }}>{t('bulk.confirm_delete', { count: selectedIds.size })}</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button onClick={() => setBulkDeleteConfirmOpen(false)} className="sh-btn-secondary">{t('books.delete_cancel')}</button>
          <button
            onClick={() => {
              bulkDeleteMutation.mutate({ ids: [...selectedIds] }, {
                onSuccess: () => { setBulkDeleteConfirmOpen(false); clearSelection() },
              })
            }}
            className="sh-btn-danger"
            disabled={bulkDeleteMutation.isPending}
          >
            {bulkDeleteMutation.isPending ? t('books.deleting') : t('bulk.delete', { count: selectedIds.size })}
          </button>
        </div>
      </Modal>

      {/* ── Bulk move ── */}
      <Modal open={bulkMoveOpen} onClose={() => setBulkMoveOpen(false)} size="sm" label={t('bulk.move_to')}>
        <h3 className="text-h3" style={{ marginTop: 0 }}>{t('bulk.move_to')}</h3>
        <label className="sh-form-label" style={{ marginTop: 12 }}>{t('bulk.move_to')}</label>
        <select className="sh-select" value={bulkMoveTarget} onChange={(e) => setBulkMoveTarget(e.target.value)} style={{ marginBottom: 12 }}>
          <option value="">{t('bulk.no_location')}</option>
          {(locationsQuery.data ?? []).map((loc) => (
            <option key={loc.id} value={loc.id}>{loc.room} / {loc.furniture} / {loc.shelf}</option>
          ))}
        </select>

        <label className="sh-form-label">{t('bulk.insert_position_label', 'Insert at position')}</label>
        <input
          className="sh-input"
          inputMode="numeric"
          placeholder={t('bulk.insert_position_placeholder', 'leave empty = append to end')}
          value={bulkInsertPosition}
          onChange={(e) => setBulkInsertPosition(e.target.value.replace(/\D/g, ''))}
          style={{ marginBottom: 8 }}
        />
        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--sh-text-muted)' }}>
          {t('bulk.insert_position_max', { max: moveTargetMaxPosition })}
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button onClick={() => setBulkMoveOpen(false)} className="sh-btn-secondary">{t('books.delete_cancel')}</button>
          <button
            onClick={() => {
              bulkMoveMutation.mutate({ ids: [...selectedIds], location_id: bulkMoveTarget || null, insert_position: bulkInsertPosition === '' ? null : Number(bulkInsertPosition) }, {
                onSuccess: () => { setBulkMoveOpen(false); clearSelection() },
              })
            }}
            className="sh-btn-primary"
            disabled={bulkMoveMutation.isPending}
          >
            {bulkMoveMutation.isPending ? '…' : t('bulk.move', { count: selectedIds.size })}
          </button>
        </div>
      </Modal>

      {/* ── Bulk status ── */}
      <Modal open={bulkStatusOpen} onClose={() => setBulkStatusOpen(false)} size="sm" label={t('bulk.change_status', { count: selectedIds.size })}>
        <h3 className="text-h3" style={{ marginTop: 0 }}>{t('bulk.change_status', { count: selectedIds.size })}</h3>
        <label className="sh-form-label" style={{ marginTop: 12 }}>{t('bulk.status_label')}</label>
        <select className="sh-select" value={bulkStatusTarget} onChange={(e) => setBulkStatusTarget(e.target.value as ReadingStatus)} style={{ marginBottom: 20 }}>
          <option value="unread">📖 {t('reading_status.unread')}</option>
          <option value="reading">🔖 {t('reading_status.reading')}</option>
          <option value="read">✅ {t('reading_status.read')}</option>
          <option value="lent">🤝 {t('reading_status.lent')}</option>
        </select>

        <label className="sh-form-label">{t('bulk.insert_position_label', 'Insert at position')}</label>
        <input
          className="sh-input"
          inputMode="numeric"
          placeholder={t('bulk.insert_position_placeholder', 'leave empty = append to end')}
          value={bulkInsertPosition}
          onChange={(e) => setBulkInsertPosition(e.target.value.replace(/\D/g, ''))}
          style={{ marginBottom: 8 }}
        />
        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--sh-text-muted)' }}>
          {t('bulk.insert_position_max', { max: moveTargetMaxPosition })}
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button onClick={() => setBulkStatusOpen(false)} className="sh-btn-secondary">{t('books.delete_cancel')}</button>
          <button
            onClick={() => {
              bulkStatusMutation.mutate({ ids: [...selectedIds], reading_status: bulkStatusTarget }, {
                onSuccess: () => { setBulkStatusOpen(false); clearSelection() },
              })
            }}
            className="sh-btn-primary"
            disabled={bulkStatusMutation.isPending}
          >
            {bulkStatusMutation.isPending ? '…' : t('bulk.change_status', { count: selectedIds.size })}
          </button>
        </div>
      </Modal>

      <Modal open={!!deleteTargetId} onClose={() => setDeleteTargetId(null)} label={t('books.delete_confirm_title')} maxWidth={380}>
        <h3 className="text-h3" style={{ marginTop: 0 }}>{t('books.delete_confirm_title')}</h3>
        <p className="text-p" style={{ marginBottom: 24 }}>{t('books.delete_confirm_body')}</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={() => setDeleteTargetId(null)}
            className="sh-btn-secondary"
          >
            {t('books.delete_cancel')}
          </button>
          <button
            onClick={() => deleteTargetId && deleteMutation.mutate(deleteTargetId, { onSuccess: () => setDeleteTargetId(null) })}
            className="sh-btn-danger"
          >
            {deleteMutation.isPending ? t('books.deleting') : t('books.delete_confirm')}
          </button>
        </div>
      </Modal>

      {/* Onboarding — show when library is empty + server says should_show */}
      <FirstBookOnboardingModal
        open={
          !onboardingDismissed
          && !booksQuery.isLoading
          && total === 0
          && onboardingQuery.data?.should_show === true
        }
        onDone={() => setOnboardingDismissed(true)}
      />
    </div>
  )
}
