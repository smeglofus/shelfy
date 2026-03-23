import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { useBook, useDeleteBook, useUpdateBook } from '../hooks/useBooks'
import { useLocations } from '../hooks/useLocations'
import { ROUTES } from '../lib/routes'
import type { ReadingStatus } from '../lib/types'

const GRADIENTS: [string, string][] = [
  ['#1D9E75', '#085041'],
  ['#BA7517', '#633806'],
  ['#534AB7', '#26215C'],
  ['#185FA5', '#042C53'],
  ['#639922', '#173404'],
  ['#993556', '#4B1528'],
]

function hashTitle(title: string): number {
  let h = 0
  for (const ch of title) h = ((h << 5) - h + ch.charCodeAt(0)) | 0
  return Math.abs(h)
}

function metadataRow(label: string, value: string | number | null | undefined) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, padding: '6px 0' }}>
      <span style={{ color: '#777', fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 14 }}>{value ?? '—'}</span>
    </div>
  )
}

function readingStatusLabel(status: ReadingStatus | null | undefined): string {
  if (!status) return 'Nepřiřazeno'
  if (status === 'unread') return 'Nepřečteno'
  if (status === 'reading') return 'Čtu'
  if (status === 'read') return 'Přečteno'
  return 'Půjčeno'
}

export function BookDetailPage() {
  const navigate = useNavigate()
  const { bookId = '' } = useParams()
  const [expandedDescription, setExpandedDescription] = useState(false)

  const bookQuery = useBook(bookId)
  const locationsQuery = useLocations()
  const updateMutation = useUpdateBook()
  const deleteMutation = useDeleteBook()

  const [locationSelection, setLocationSelection] = useState<string | null | undefined>(undefined)
  const [readingSelection, setReadingSelection] = useState<ReadingStatus | null | undefined>(undefined)
  const [lentToSelection, setLentToSelection] = useState<string | undefined>(undefined)

  if (bookQuery.isLoading) {
    return <p>Loading book…</p>
  }

  if (bookQuery.isError || !bookQuery.data) {
    return (
      <div>
        <p>Failed to load book.</p>
        <Link to={ROUTES.books}>Back to books</Link>
      </div>
    )
  }

  const book = bookQuery.data

  const selectedLocation =
    locationSelection === undefined ? (book.location_id ?? '') : (locationSelection ?? '')
  const selectedReading = readingSelection === undefined ? (book.reading_status ?? null) : readingSelection
  const selectedLentTo = lentToSelection === undefined ? (book.lent_to ?? '') : lentToSelection

  const loc = (locationsQuery.data ?? []).find((l) => l.id === selectedLocation)
  const selectedLocLabel = loc ? `${loc.room} / ${loc.furniture} / ${loc.shelf}` : null

  const [from, to] = GRADIENTS[hashTitle(book.title) % GRADIENTS.length]
  const longDesc = (book.description ?? '').length > 160

  return (
    <section style={{ marginTop: '1.5rem', maxWidth: 760, marginInline: 'auto', padding: '0 16px 24px' }}>
      <div style={{ marginBottom: 10 }}>
        <Link to={ROUTES.books}>← Back to books</Link>
      </div>

      <article style={{ border: '0.5px solid rgba(0,0,0,0.10)', borderRadius: 14, overflow: 'hidden', background: 'white' }}>
        {book.cover_image_url ? (
          <img
            src={book.cover_image_url}
            alt={book.title}
            style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: 200,
              background: `linear-gradient(135deg, ${from}, ${to})`,
              display: 'flex',
              alignItems: 'flex-end',
              padding: 16,
            }}
          >
            <span style={{ color: 'white', fontSize: 18, fontWeight: 600, textShadow: '0 1px 3px rgba(0,0,0,0.35)' }}>
              {book.title}
            </span>
          </div>
        )}

        <div style={{ padding: 16 }}>
          <h2 style={{ fontSize: 26, lineHeight: 1.2, marginBottom: 6 }}>{book.title}</h2>
          <p style={{ color: '#666', marginBottom: 12 }}>{book.author ?? '—'}</p>

          <hr style={{ border: 0, borderTop: '0.5px solid rgba(0,0,0,0.12)', margin: '10px 0 12px' }} />
          {metadataRow('ISBN', book.isbn)}
          {metadataRow('Vydavatel', book.publisher)}
          {metadataRow('Rok vydání', book.publication_year)}
          {metadataRow('Jazyk', book.language)}
          {metadataRow('Stav', book.processing_status)}

          <hr style={{ border: 0, borderTop: '0.5px solid rgba(0,0,0,0.12)', margin: '12px 0 12px' }} />
          <div>
            <p style={{ fontSize: 12, color: '#777', marginBottom: 6 }}>Popis</p>
            {book.description ? (
              <>
                <p
                  style={{
                    fontSize: 14,
                    color: '#333',
                    lineHeight: 1.5,
                    display: '-webkit-box',
                    WebkitLineClamp: !expandedDescription ? 3 : 'unset',
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {book.description}
                </p>
                {longDesc && (
                  <button
                    type="button"
                    onClick={() => setExpandedDescription((v) => !v)}
                    style={{ marginTop: 6, border: 'none', background: 'transparent', color: '#1D9E75', cursor: 'pointer', padding: 0 }}
                  >
                    {expandedDescription ? 'Sbalit' : 'Rozbalit'}
                  </button>
                )}
              </>
            ) : (
              <p style={{ fontSize: 14 }}>—</p>
            )}
          </div>

          <hr style={{ border: 0, borderTop: '0.5px solid rgba(0,0,0,0.12)', margin: '14px 0 12px' }} />

          <form
            aria-label="assign-location-form"
            onSubmit={(event) => {
              event.preventDefault()
              updateMutation.mutate({
                id: book.id,
                payload: {
                  location_id: selectedLocation || null,
                  reading_status: selectedReading,
                  lent_to: selectedReading === 'lent' ? (selectedLentTo || null) : null,
                },
              })
            }}
            style={{ display: 'grid', gap: 12 }}
          >
            <div>
              <label style={{ fontSize: 12, color: '#777' }}>Stav čtení</label>
              <select
                aria-label="Reading status"
                value={selectedReading ?? ''}
                onChange={(event) => {
                  const raw = event.target.value as ReadingStatus | ''
                  setReadingSelection(raw ? raw : null)
                }}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '0.5px solid rgba(0,0,0,0.18)', marginTop: 4 }}
              >
                <option value="">Nepřiřazeno</option>
                <option value="unread">Nepřečteno</option>
                <option value="reading">Čtu</option>
                <option value="read">Přečteno</option>
                <option value="lent">Půjčeno</option>
              </select>
              <p style={{ marginTop: 4, fontSize: 12, color: '#666' }}>Aktuálně: {readingStatusLabel(selectedReading)}</p>
            </div>

            {selectedReading === 'lent' && (
              <div>
                <label style={{ fontSize: 12, color: '#777' }}>Komu půjčeno</label>
                <input
                  aria-label="Lent to"
                  value={selectedLentTo}
                  onChange={(event) => setLentToSelection(event.target.value)}
                  placeholder="Jméno"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '0.5px solid rgba(0,0,0,0.18)', marginTop: 4 }}
                />
              </div>
            )}

            <div>
              <label style={{ fontSize: 12, color: '#777' }}>Umístění</label>
              <select
                aria-label="Assign location"
                value={selectedLocation}
                onChange={(event) => setLocationSelection(event.target.value || null)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '0.5px solid rgba(0,0,0,0.18)', marginTop: 4 }}
              >
                <option value="">Nezařazeno</option>
                {(locationsQuery.data ?? []).map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.room} / {location.furniture} / {location.shelf}
                  </option>
                ))}
              </select>
              <p style={{ marginTop: 4, fontSize: 12, color: '#666' }}>{selectedLocLabel ?? 'Nezařazeno'}</p>
            </div>

            <button
              type="submit"
              disabled={updateMutation.isPending}
              style={{
                justifySelf: 'start',
                padding: '10px 16px',
                borderRadius: 10,
                border: 'none',
                background: '#1D9E75',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              {updateMutation.isPending ? 'Saving…' : 'Uložit změny'}
            </button>
          </form>

          <hr style={{ border: 0, borderTop: '0.5px solid rgba(0,0,0,0.12)', margin: '14px 0 12px' }} />
          <button
            type="button"
            onClick={() => {
              if (!confirm('Opravdu smazat tuto knihu?')) return
              deleteMutation.mutate(book.id, {
                onSuccess: () => navigate(ROUTES.books),
              })
            }}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              border: '0.5px solid rgba(200,70,70,0.35)',
              background: '#fff1f1',
              color: '#a33434',
              cursor: 'pointer',
            }}
          >
            {deleteMutation.isPending ? 'Mažu…' : 'Smazat knihu'}
          </button>
        </div>
      </article>
    </section>
  )
}
