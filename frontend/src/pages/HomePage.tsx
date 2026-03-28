import { useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useQueries } from '@tanstack/react-query'

import { useBooks } from '../hooks/useBooks'
import { useLocations } from '../hooks/useLocations'
import { listBooks } from '../lib/api'

export function HomePage() {
  const { t, i18n } = useTranslation()
  const summaryQuery = useBooks({ page: 1, pageSize: 5 })
  const locationsQuery = useLocations()

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }),
    [i18n.language],
  )

  const booksPerLocationQueries = useQueries({
    queries: (locationsQuery.data ?? []).map((location) => ({
      queryKey: ['books', 'location-count', location.id],
      queryFn: () => listBooks({ locationId: location.id, page: 1, pageSize: 1 }),
      retry: false,
    })),
  })

  const isLocationCountsLoading = booksPerLocationQueries.some((query) => query.isLoading)
  const isLocationCountsError = booksPerLocationQueries.some((query) => query.isError)

  if (summaryQuery.isLoading || locationsQuery.isLoading || isLocationCountsLoading) {
    return <div className="container"><p className="text-p">{t('home.loading')}</p></div>
  }

  if (summaryQuery.isError || locationsQuery.isError || isLocationCountsError) {
    return (
      <div className="container">
        <p className="text-p" style={{ color: 'var(--sh-red)' }}>
          {t('home.error')}
        </p>
        <button
          className="sh-btn-secondary"
          style={{ marginTop: 12 }}
          onClick={() => {
            void summaryQuery.refetch()
            void locationsQuery.refetch()
            void Promise.all(booksPerLocationQueries.map((query) => query.refetch()))
          }}
        >
          {t('home.retry')}
        </button>
      </div>
    )
  }

  const booksPerLocationTotalById = new Map<string, number>()
  for (let index = 0; index < (locationsQuery.data ?? []).length; index += 1) {
    const location = locationsQuery.data?.[index]
    const locationCountQuery = booksPerLocationQueries[index]
    if (location) {
      booksPerLocationTotalById.set(location.id, locationCountQuery?.data?.total ?? 0)
    }
  }

  return (
    <section className="container md-max-w-4xl flex-col gap-6" style={{ margin: '0 auto', width: '100%' }}>
      <div className="md-grid-2">
        <div className="flex-col gap-6">
          <div>
            <h2 className="text-h1" style={{ marginBottom: 4 }}>{t('home.overview')}</h2>
            <p className="text-p">
              <Trans
                i18nKey="home.total_books"
                values={{ count: summaryQuery.data?.total ?? 0 }}
                components={{ strong: <strong style={{ color: 'var(--sh-teal)' }} /> }}
              />
            </p>
          </div>

          <div>
            <h3 className="text-h3" style={{ marginTop: 0 }}>{t('home.by_location')}</h3>
            <div className="flex-col gap-3">
              {(locationsQuery.data ?? []).map((location) => (
                <div
                  key={location.id}
                  style={{
                    background: 'var(--sh-surface)',
                    border: '1px solid var(--sh-border)',
                    borderRadius: 'var(--sh-radius-md)',
                    padding: '16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    boxShadow: 'var(--sh-shadow-sm)',
                  }}
                  className="hover-lift"
                >
                  <span className="text-p" style={{ fontWeight: 500 }}>
                    {location.room} / {location.furniture} / {location.shelf}
                  </span>
                  <span
                    style={{
                      background: 'var(--sh-teal-bg)',
                      color: 'var(--sh-teal-text)',
                      padding: '4px 12px',
                      borderRadius: 'var(--sh-radius-pill)',
                      fontWeight: 600,
                      fontSize: 14,
                    }}
                  >
                    {booksPerLocationTotalById.get(location.id) ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-col gap-6">
          <div>
            <h3 className="text-h3" style={{ marginTop: 0 }}>{t('home.recently_added')}</h3>
            <div className="flex-col gap-3">
              {(summaryQuery.data?.items ?? []).map((book) => (
                <div
                  key={book.id}
                  style={{
                    background: 'var(--sh-surface)',
                    border: '1px solid var(--sh-border)',
                    borderRadius: 'var(--sh-radius-md)',
                    padding: '16px',
                    boxShadow: 'var(--sh-shadow-sm)',
                  }}
                  className="hover-lift flex-col gap-2"
                >
                  <span className="text-p" style={{ fontWeight: 600 }}>{book.title}</span>
                  <span className="text-small" style={{ color: 'var(--sh-text-muted)' }}>
                    {t('home.added_on', { date: dateFormatter.format(new Date(book.created_at)) })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
