import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BookCard } from '../components/BookCard'
import { EmptyLibraryIcon, NoResultsIcon } from '../components/EmptyStateIcons'
import { Modal } from '../components/Modal'
import { ShelfBreadcrumb } from '../components/ShelfBreadcrumb'
import { SkeletonBookGrid } from '../components/Skeleton'
import { StatBar } from '../components/StatBar'
import { useBooks, useDeleteBook, useJobStatus } from '../hooks/useBooks'
import { useDebounce } from '../hooks/useDebounce'
import { useLocations } from '../hooks/useLocations'
import { useToastStore } from '../lib/toast-store'
import type { Book, Location, ReadingStatus } from '../lib/types'

const PAGE_SIZE = 20
type StatFilter = 'total' | 'read' | 'reading' | 'lent'

export function BooksPage() {
  const { t } = useTranslation()
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebounce(searchInput.trim(), 300)
  const [page, setPage] = useState(1)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [uploadJobId, setUploadJobId] = useState<string | null>(null)
  const [readingFilter, setReadingFilter] = useState<ReadingStatus | null>(null)
  const [locationFilter, setLocationFilter] = useState<string>('all')
  const [statFilter, setStatFilter] = useState<StatFilter>('total')
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

  // Reset to page 1 when search changes
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  const queryParams = useMemo(
    () => ({ page, pageSize: PAGE_SIZE, search: debouncedSearch || undefined, readingStatus: readingFilter ?? undefined, locationId: locationFilter !== 'all' && locationFilter !== 'unassigned' ? locationFilter : undefined }),
    [page, debouncedSearch, readingFilter, locationFilter],
  )

  const booksQuery = useBooks(queryParams)
  const locationsQuery = useLocations()
  const deleteMutation = useDeleteBook()
  const uploadJobStatusQuery = useJobStatus(uploadJobId)
  const showError = useToastStore((s) => s.showError)

  const locationById = useMemo(() => {
    const m = new Map<string, Location>()
    for (const loc of locationsQuery.data ?? []) m.set(loc.id, loc)
    return m
  }, [locationsQuery.data])

  useEffect(() => {
    const failed = (booksQuery.data?.items ?? []).filter(
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
    let raw = booksQuery.data?.items ?? []
    if (locationFilter === 'unassigned') {
      raw = raw.filter((book) => !book.location_id)
    }

    if (statFilter === 'lent') {
      raw = raw.filter((book) => !!book.is_currently_lent)
    }

    return raw
  }, [booksQuery.data?.items, locationFilter, statFilter])

  const groups = useMemo(() => {
    const map = new Map<string | null, Book[]>()
    for (const b of books) {
      const key = b.location_id ?? null
      if (!map.has(key)) map.set(key, [])
      map.get(key)?.push(b)
    }
    return map
  }, [books])

  const total = booksQuery.data?.total ?? 0

  const booksCountLabel = useMemo(() => {
    if (total === 1) return t('books.count_one', { count: total })
    if (total > 1 && total < 5) return t('books.count_few', { count: total })
    return t('books.count_many', { count: total })
  }, [t, total])

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
            setPage(1)
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
                setPage(1)
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

      <div style={{ margin: '12px 24px 0', display: 'flex', justifyContent: 'flex-end' }}>
        <select
          className="sh-select"
          value={locationFilter}
          onChange={(event) => {
            setLocationFilter(event.target.value)
            setPage(1)
          }}
          style={{ minWidth: 220 }}
        >
          <option value="all">All locations</option>
          <option value="unassigned">Unassigned</option>
          {(locationsQuery.data ?? []).map((location) => (
            <option key={location.id} value={location.id}>
              {location.room} / {location.furniture} / {location.shelf}
            </option>
          ))}
        </select>
      </div>

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

        {!booksQuery.isLoading && !booksQuery.isError && total === 0 && (
          <div className="sh-empty-state">
            <div className="sh-empty-state__icon">
              <EmptyLibraryIcon size={56} />
            </div>
            <p className="text-h3" style={{ color: 'var(--sh-text-main)', marginTop: 0 }}>{t('books.empty_title')}</p>
            <p className="text-p">
              {debouncedSearch ? t('books.empty_search', { query: debouncedSearch }) : t('books.empty_library')}
            </p>
          </div>
        )}

        {!booksQuery.isLoading && !booksQuery.isError && total > 0 && readingFilter && books.length === 0 && (
          <div className="sh-empty-state">
            <div className="sh-empty-state__icon">
              <NoResultsIcon size={56} />
            </div>
            <p className="text-h3" style={{ color: 'var(--sh-text-main)', marginTop: 0 }}>
              {t('books.empty_category')}
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
                  <BookCard key={b.id} book={b} onDelete={setDeleteTargetId} index={i} />
                ))}
              </div>
            </div>
          )
        })}

        {total > PAGE_SIZE && (
          <div className="sh-pagination">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="sh-btn-secondary"
              style={{ opacity: page <= 1 ? 0.3 : 1, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}
            >
              {t('books.prev_page')}
            </button>
            <span className="sh-pagination__info">
              {page} / {Math.ceil(total / PAGE_SIZE)}
            </span>
            <button
              disabled={page >= Math.ceil(total / PAGE_SIZE)}
              onClick={() => setPage((p) => p + 1)}
              className="sh-btn-secondary"
              style={{ opacity: page >= Math.ceil(total / PAGE_SIZE) ? 0.3 : 1, cursor: page >= Math.ceil(total / PAGE_SIZE) ? 'not-allowed' : 'pointer' }}
            >
              {t('books.next_page')}
            </button>
          </div>
        )}
      </div>

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
    </div>
  )
}
