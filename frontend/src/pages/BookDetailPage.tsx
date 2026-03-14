import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { useBook, useUpdateBook } from '../hooks/useBooks'
import { useLocations } from '../hooks/useLocations'

export function BookDetailPage() {
  const { bookId = '' } = useParams()
  const bookQuery = useBook(bookId)
  const locationsQuery = useLocations()
  const updateMutation = useUpdateBook({ page: 1, pageSize: 10 })
  const [locationSelection, setLocationSelection] = useState('')

  if (bookQuery.isLoading) {
    return <p>Loading book…</p>
  }

  if (bookQuery.isError || !bookQuery.data) {
    return <p>Failed to load book.</p>
  }

  const book = bookQuery.data

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2>{book.title}</h2>
      <dl>
        <dt>Author</dt>
        <dd>{book.author ?? '—'}</dd>
        <dt>ISBN</dt>
        <dd>{book.isbn ?? '—'}</dd>
        <dt>Publisher</dt>
        <dd>{book.publisher ?? '—'}</dd>
        <dt>Language</dt>
        <dd>{book.language ?? '—'}</dd>
        <dt>Description</dt>
        <dd>{book.description ?? '—'}</dd>
        <dt>Publication year</dt>
        <dd>{book.publication_year ?? '—'}</dd>
        <dt>Cover URL</dt>
        <dd>{book.cover_image_url ?? '—'}</dd>
        <dt>Processing status</dt>
        <dd>{book.processing_status}</dd>
      </dl>

      <form
        aria-label="assign-location-form"
        onSubmit={(event) => {
          event.preventDefault()
          updateMutation.mutate({
            id: book.id,
            payload: { location_id: locationSelection || null },
          })
        }}
      >
        <label>
          Location
          <select
            aria-label="Assign location"
            value={locationSelection || book.location_id || ''}
            onChange={(event) => setLocationSelection(event.target.value)}
          >
            <option value="">Unassigned</option>
            {(locationsQuery.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.room} / {location.furniture} / {location.shelf}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={updateMutation.isPending}>
          {updateMutation.isPending ? 'Saving…' : 'Save location'}
        </button>
      </form>
    </section>
  )
}
