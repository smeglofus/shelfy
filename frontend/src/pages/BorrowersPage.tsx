import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { NoResultsIcon } from '../components/EmptyStateIcons'
import { useDebounce } from '../hooks/useDebounce'
import { useBorrowers } from '../hooks/useBorrowers'
import { displayBorrowerName } from '../lib/borrowerDisplay'
import { getBorrowerDetailRoute } from '../lib/routes'
import type { BorrowerListItem } from '../lib/types'

const PAGE_SIZE = 20

function formatDate(value: string | null, locale: string): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString(locale)
  } catch {
    return value
  }
}

export function BorrowersPage() {
  const { t, i18n } = useTranslation()
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)

  // Server-side search means the input has to settle before we re-fetch.
  // 250ms is the standard "felt instant but not a query per keystroke" range.
  const debouncedSearch = useDebounce(searchInput, 250)

  // Reset to page 1 whenever the search query changes — otherwise typing on
  // page 4 could leave the user on an empty page that doesn't exist for the
  // narrowed result set.
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  const borrowersQuery = useBorrowers({
    search: debouncedSearch,
    page,
    pageSize: PAGE_SIZE,
  })

  const data = borrowersQuery.data
  const items: BorrowerListItem[] = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const isInitialLoading = borrowersQuery.isLoading
  const hasAnyData = data !== undefined
  const hasResults = items.length > 0

  const headerCounts = useMemo(() => {
    if (!hasAnyData) return null
    return total === 0 && !debouncedSearch
      ? null
      : t('borrowers.result_counter', { count: total })
  }, [hasAnyData, total, debouncedSearch, t])

  return (
    <main className="sh-main" style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 className="text-h2" style={{ margin: 0 }}>{t('borrowers.title')}</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--sh-text-muted)' }}>
          {t('borrowers.subtitle')}
        </p>
      </header>

      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <input
          type="search"
          className="sh-input"
          placeholder={t('borrowers.search_placeholder')}
          aria-label={t('borrowers.search_placeholder')}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          style={{ flex: 1 }}
        />
        {headerCounts && (
          <span
            data-testid="borrowers-result-counter"
            style={{ color: 'var(--sh-text-muted)', fontSize: 13, whiteSpace: 'nowrap' }}
          >
            {headerCounts}
          </span>
        )}
      </div>

      {isInitialLoading && (
        <p data-testid="borrowers-loading" style={{ color: 'var(--sh-text-muted)' }}>
          {t('borrowers.loading')}
        </p>
      )}

      {hasAnyData && total === 0 && !debouncedSearch && (
        <div
          data-testid="borrowers-empty"
          style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--sh-text-muted)' }}
        >
          <NoResultsIcon size={64} />
          <h2 className="text-h3" style={{ marginTop: 12, color: 'var(--sh-text-main)' }}>
            {t('borrowers.empty_title')}
          </h2>
          <p style={{ margin: '4px 0 0' }}>{t('borrowers.empty_description')}</p>
        </div>
      )}

      {hasAnyData && total === 0 && debouncedSearch && (
        <div
          data-testid="borrowers-no-results"
          style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--sh-text-muted)' }}
        >
          {t('borrowers.no_results', { query: debouncedSearch })}
        </div>
      )}

      {hasResults && (
        <ul
          data-testid="borrowers-list"
          style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}
        >
          {items.map((borrower) => (
            <li key={borrower.id}>
              <Link
                to={getBorrowerDetailRoute(borrower.id)}
                data-testid={`borrower-row-${borrower.id}`}
                className="sh-card"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 12,
                  padding: 16,
                  textDecoration: 'none',
                  color: 'inherit',
                  border: '1px solid var(--sh-border)',
                  borderRadius: 'var(--sh-radius-md)',
                  background: 'var(--sh-surface)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 15,
                      fontStyle: borrower.anonymized_at ? 'italic' : undefined,
                      color: borrower.anonymized_at ? 'var(--sh-text-muted)' : undefined,
                    }}
                  >
                    {displayBorrowerName(borrower, t)}
                  </div>
                  {borrower.contact && (
                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--sh-text-muted)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {borrower.contact}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridAutoFlow: 'column',
                    gap: 12,
                    alignItems: 'center',
                    fontSize: 12,
                    color: 'var(--sh-text-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span data-testid={`borrower-active-${borrower.id}`}>
                    {t('borrowers.active_count', { count: borrower.active_loans })}
                  </span>
                  <span data-testid={`borrower-total-${borrower.id}`}>
                    {t('borrowers.total_count', { count: borrower.total_loans })}
                  </span>
                  <span data-testid={`borrower-last-${borrower.id}`}>
                    {borrower.last_activity_at
                      ? t('borrowers.last_activity', {
                          date: formatDate(borrower.last_activity_at, i18n.language),
                        })
                      : t('borrowers.no_activity')}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hasResults && totalPages > 1 && (
        <nav
          aria-label={t('borrowers.pagination_label')}
          data-testid="borrowers-paginator"
          style={{
            marginTop: 16,
            display: 'flex',
            gap: 8,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <button
            type="button"
            className="sh-btn-secondary"
            data-testid="borrowers-prev-page"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t('borrowers.prev_page')}
          </button>
          <span style={{ color: 'var(--sh-text-muted)', fontSize: 13 }}>
            {t('borrowers.page_indicator', { page, total: totalPages })}
          </span>
          <button
            type="button"
            className="sh-btn-secondary"
            data-testid="borrowers-next-page"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            {t('borrowers.next_page')}
          </button>
        </nav>
      )}
    </main>
  )
}
