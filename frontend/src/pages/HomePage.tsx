import { useMemo } from 'react'

import { useBooks } from '../hooks/useBooks'
import { useLocations } from '../hooks/useLocations'

export function HomePage() {
  const booksQuery = useBooks({ page: 1, pageSize: 20 })
  const locationsQuery = useLocations()

  const booksPerLocation = useMemo(() => {
    const counts = new Map<string, number>()
    for (const location of locationsQuery.data ?? []) {
      counts.set(location.id, 0)
    }

    for (const book of booksQuery.data?.items ?? []) {
      if (book.location_id) {
        counts.set(book.location_id, (counts.get(book.location_id) ?? 0) + 1)
      }
    }

    return counts
  }, [booksQuery.data?.items, locationsQuery.data])

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2>Dashboard</h2>
      <p>Total books: {booksQuery.data?.total ?? 0}</p>

      <h3>Books per location</h3>
      <ul>
        {(locationsQuery.data ?? []).map((location) => (
          <li key={location.id}>
            {location.room} / {location.furniture} / {location.shelf}: {booksPerLocation.get(location.id) ?? 0}
          </li>
        ))}
      </ul>

      <h3>Recent additions</h3>
      <ul>
        {(booksQuery.data?.items ?? [])
          .slice()
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
          .slice(0, 5)
          .map((book) => (
            <li key={book.id}>
              {book.title} ({new Date(book.created_at).toLocaleDateString()})
            </li>
          ))}
      </ul>
    </section>
  )
}
