import { useQueries } from '@tanstack/react-query'

import { listBooks } from '../lib/api'
import { useBooks } from '../hooks/useBooks'
import { useLocations } from '../hooks/useLocations'

export function HomePage() {
  const summaryQuery = useBooks({ page: 1, pageSize: 5 })
  const locationsQuery = useLocations()

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
    return <p>Loading dashboard…</p>
  }

  if (summaryQuery.isError || locationsQuery.isError || isLocationCountsError) {
    return (
      <p>
        Failed to load dashboard.
        <button
          type="button"
          onClick={() => {
            void summaryQuery.refetch()
            void locationsQuery.refetch()
            void Promise.all(booksPerLocationQueries.map((query) => query.refetch()))
          }}
        >
          Retry
        </button>
      </p>
    )
  }

  const booksPerLocationTotalById = new Map<string, number>()
  for (let index = 0; index < (locationsQuery.data ?? []).length; index += 1) {
    const location = locationsQuery.data![index]
    const locationCountQuery = booksPerLocationQueries[index]
    booksPerLocationTotalById.set(location.id, locationCountQuery?.data?.total ?? 0)
  }

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2>Dashboard</h2>
      <p>Total books: {summaryQuery.data?.total ?? 0}</p>

      <h3>Books per location</h3>
      <ul>
        {(locationsQuery.data ?? []).map((location) => (
          <li key={location.id}>
            {location.room} / {location.furniture} / {location.shelf}:{' '}
            {booksPerLocationTotalById.get(location.id) ?? 0}
          </li>
        ))}
      </ul>

      <h3>Recent additions</h3>
      <ul>
        {(summaryQuery.data?.items ?? []).map((book) => (
          <li key={book.id}>
            {book.title} ({new Date(book.created_at).toLocaleDateString()})
          </li>
        ))}
      </ul>
    </section>
  )
}
