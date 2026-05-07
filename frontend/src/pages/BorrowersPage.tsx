import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { NoResultsIcon } from '../components/EmptyStateIcons'
import { useBorrowers } from '../hooks/useBorrowers'
import { getBorrowerDetailRoute } from '../lib/routes'
import type { BorrowerListItem } from '../lib/types'

function formatDate(value: string | null, locale: string): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString(locale)
  } catch {
    return value
  }
}

function matchesSearch(borrower: BorrowerListItem, query: string): boolean {
  if (!query.trim()) return true
  const target = query.trim().toLowerCase()
  return borrower.name.toLowerCase().includes(target)
}

export function BorrowersPage() {
  const { t, i18n } = useTranslation()
  const borrowersQuery = useBorrowers()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const all = borrowersQuery.data ?? []
    return all.filter((b) => matchesSearch(b, search))
  }, [borrowersQuery.data, search])

  const isLoading = borrowersQuery.isLoading
  const total = borrowersQuery.data?.length ?? 0

  return (
    <main className="sh-main" style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 className="text-h2" style={{ margin: 0 }}>{t('borrowers.title')}</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--sh-text-muted)' }}>
          {t('borrowers.subtitle')}
        </p>
      </header>

      <div style={{ marginBottom: 16 }}>
        <input
          type="search"
          className="sh-input"
          placeholder={t('borrowers.search_placeholder')}
          aria-label={t('borrowers.search_placeholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {isLoading && (
        <p data-testid="borrowers-loading" style={{ color: 'var(--sh-text-muted)' }}>
          {t('borrowers.loading')}
        </p>
      )}

      {!isLoading && total === 0 && (
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

      {!isLoading && total > 0 && filtered.length === 0 && (
        <div
          data-testid="borrowers-no-results"
          style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--sh-text-muted)' }}
        >
          {t('borrowers.no_results', { query: search.trim() })}
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <ul
          data-testid="borrowers-list"
          style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}
        >
          {filtered.map((borrower) => (
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
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{borrower.name}</div>
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
    </main>
  )
}
