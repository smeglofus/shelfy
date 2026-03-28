import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { useBook, useDeleteBook, useUpdateBook } from '../hooks/useBooks'
import { useLocations } from '../hooks/useLocations'
import { ROUTES } from '../lib/routes'
import type { ReadingStatus } from '../lib/types'

const GRADIENTS: [string, string][] = [
  ['#1D9E75', '#085041'],
  ['#F4B400', '#7a5a00'],
  ['#9b51e0', '#41156d'],
  ['#4285F4', '#174ea6'],
  ['#639922', '#173404'],
  ['#DB4437', '#7C1004'],
]

function hashTitle(title: string): number {
  let h = 0
  for (const ch of title) h = ((h << 5) - h + ch.charCodeAt(0)) | 0
  return Math.abs(h)
}

function metadataRow(label: string, value: string | number | null | undefined) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(100px, 1fr) 2fr', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--sh-border)', alignItems: 'center' }}>
      <span style={{ color: 'var(--sh-text-muted)', fontSize: 13, fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--sh-text-main)' }}>{value ?? '—'}</span>
    </div>
  )
}

export function BookDetailPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { bookId = '' } = useParams()
  const [expandedDescription, setExpandedDescription] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  const bookQuery = useBook(bookId)
  const locationsQuery = useLocations()
  const updateMutation = useUpdateBook()
  const deleteMutation = useDeleteBook()

  const [locationSelection, setLocationSelection] = useState<string | null | undefined>(undefined)
  const [readingSelection, setReadingSelection] = useState<ReadingStatus | null | undefined>(undefined)

  if (bookQuery.isLoading) {
    return <div className="container"><p className="text-p">{t('book_detail.loading')}</p></div>
  }

  if (bookQuery.isError || !bookQuery.data) {
    return (
      <div className="container">
        <p className="text-p" style={{ color: 'var(--sh-red)' }}>{t('book_detail.load_error')}</p>
        <button onClick={() => navigate(ROUTES.books)} className="sh-btn-secondary" style={{ marginTop: 16 }}>{t('book_detail.back_to_library')}</button>
      </div>
    )
  }

  const book = bookQuery.data

  const selectedLocation =
    locationSelection === undefined ? (book.location_id ?? '') : (locationSelection ?? '')
  const selectedReading = readingSelection === undefined ? (book.reading_status ?? 'unread') : readingSelection
  const [from, to] = GRADIENTS[hashTitle(book.title) % GRADIENTS.length]
  const longDesc = (book.description ?? '').length > 160

  return (
    <section className="container md-max-w-3xl" style={{ paddingBottom: 40, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <button
          onClick={() => navigate(ROUTES.books)}
          style={{ width: 40, height: 40, borderRadius: 'var(--sh-radius-md)', border: '1px solid var(--sh-border)', background: 'var(--sh-surface)', cursor: 'pointer', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          className="hover-lift"
        >
          {t('book_detail.back')}
        </button>
        <h2 className="text-h2" style={{ marginBottom: 0 }}>{t('book_detail.title')}</h2>
      </div>

      <article style={{ border: '1px solid var(--sh-border)', borderRadius: 'var(--sh-radius-xl)', overflow: 'hidden', background: 'var(--sh-surface)', boxShadow: 'var(--sh-shadow-md)' }}>
        {book.cover_image_url ? (
          <div style={{ position: 'relative' }}>
            <img
              src={book.cover_image_url}
              alt={book.title}
              style={{ width: '100%', height: 260, objectFit: 'cover', display: 'block' }}
            />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 100%)', pointerEvents: 'none' }} />
          </div>
        ) : (
          <div
            style={{
              width: '100%',
              height: 240,
              background: `linear-gradient(135deg, ${from}, ${to})`,
              display: 'flex',
              alignItems: 'flex-end',
              padding: 24,
              position: 'relative',
            }}
          >
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 100%)', pointerEvents: 'none' }} />
            <span style={{ color: 'white', fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', textShadow: '0 2px 6px rgba(0,0,0,0.4)', position: 'relative', zIndex: 1, maxWidth: '90%' }}>
              {book.title}
            </span>
          </div>
        )}

        <div style={{ padding: 24 }}>
          <h2 className="text-h1" style={{ marginBottom: 4, lineHeight: 1.2 }}>{book.title}</h2>
          <p className="text-p" style={{ fontSize: 18, color: 'var(--sh-text-muted)', marginBottom: 24, fontWeight: 500 }}>{book.author ?? t('book_detail.unknown_author')}</p>

          <div style={{ background: '#FAFAFB', padding: '0 16px', borderRadius: 'var(--sh-radius-lg)', marginBottom: 24, border: '1px solid var(--sh-border)' }}>
            {metadataRow(t('book_detail.isbn'), book.isbn)}
            {metadataRow(t('book_detail.publisher'), book.publisher)}
            {metadataRow(t('book_detail.year'), book.publication_year)}
            {metadataRow(t('book_detail.language'), book.language)}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(100px, 1fr) 2fr', gap: 12, padding: '12px 0', alignItems: 'center' }}>
              <span style={{ color: 'var(--sh-text-muted)', fontSize: 13, fontWeight: 500 }}>{t('book_detail.scan_status')}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--sh-text-main)', display: 'inline-block', background: book.processing_status === 'done' ? 'var(--sh-teal-bg)' : 'var(--sh-amber-bg)', padding: '2px 8px', borderRadius: 'var(--sh-radius-pill)' }}>{t(`processing_status.${book.processing_status}`)}</span>
            </div>
          </div>

          <div>
            <h3 className="text-h3" style={{ marginTop: 0 }}>{t('book_detail.description_title')}</h3>
            {book.description ? (
              <>
                <p
                  className="text-p"
                  style={{
                    lineHeight: 1.6,
                    color: 'var(--sh-text-main)',
                    display: '-webkit-box',
                    WebkitLineClamp: !expandedDescription ? 4 : 'unset',
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
                    style={{ marginTop: 8, border: 'none', background: 'transparent', color: 'var(--sh-teal)', cursor: 'pointer', padding: 0, fontWeight: 600, fontSize: 14 }}
                  >
                    {expandedDescription ? t('book_detail.collapse') : t('book_detail.expand')}
                  </button>
                )}
              </>
            ) : (
              <p className="text-p" style={{ fontStyle: 'italic', color: 'var(--sh-text-muted)' }}>{t('book_detail.no_description')}</p>
            )}
          </div>

          <hr style={{ border: 0, borderTop: '1px solid var(--sh-border)', margin: '24px 0' }} />

          <h3 className="text-h3" style={{ marginTop: 0 }}>{t('book_detail.management_title')}</h3>
          <form
            aria-label="assign-location-form"
            onSubmit={(event) => {
              event.preventDefault()
              updateMutation.mutate({
                id: book.id,
                payload: {
                  location_id: selectedLocation || null,
                  reading_status: selectedReading,
                },
              })
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--sh-text-main)', display: 'block', marginBottom: 6 }}>{t('book_detail.reading_status_label')}</label>
                <select
                  aria-label={t('book_detail.reading_status_label')}
                  className="sh-select"
                  value={selectedReading ?? ''}
                  onChange={(event) => {
                    const raw = event.target.value as ReadingStatus | ''
                    setReadingSelection(raw ? raw : null)
                  }}
                  style={{ padding: '12px 14px' }}
                >
                  <option value="">{t('reading_status.unassigned')}</option>
                  <option value="unread">{t('reading_status.unread')}</option>
                  <option value="reading">{t('reading_status.reading')}</option>
                  <option value="read">{t('reading_status.read')}</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--sh-text-main)', display: 'block', marginBottom: 6 }}>{t('book_detail.location_label')}</label>
              <select
                aria-label={t('book_detail.location_label')}
                disabled={locationsQuery.isLoading || locationsQuery.isError}
                className="sh-select"
                value={selectedLocation}
                onChange={(event) => setLocationSelection(event.target.value || null)}
                style={{ padding: '12px 14px' }}
              >
                <option value="">{t('book_detail.location_unassigned')}</option>
                {locationsQuery.isLoading && <option disabled>{t('book_detail.location_loading')}</option>}
                {locationsQuery.isError && <option disabled>{t('book_detail.location_error')}</option>}
                {(locationsQuery.data ?? []).map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.room} / {location.furniture} / {location.shelf}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className="sh-btn-primary hover-scale"
              disabled={updateMutation.isPending}
              style={{
                alignSelf: 'flex-start',
                marginTop: 8,
              }}
            >
              {updateMutation.isPending ? t('book_detail.saving') : t('book_detail.save')}
            </button>
          </form>

          <hr style={{ border: 0, borderTop: '1px solid var(--sh-border)', margin: '24px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteMutation.isPending) return
                setDeleteConfirmOpen(true)
              }}
              className="sh-btn-primary hover-scale"
              style={{
                background: '#fff1f1',
                color: 'var(--sh-red)',
                boxShadow: 'none',
              }}
            >
              {deleteMutation.isPending ? t('book_detail.deleting') : t('book_detail.delete')}
            </button>
          </div>
        </div>
      </article>

      {deleteConfirmOpen && (
        <div
          role="dialog"
          aria-label="delete-book-dialog"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
            padding: '0 24px',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <div style={{ background: 'var(--sh-surface)', borderRadius: 'var(--sh-radius-xl)', padding: '24px', width: '100%', maxWidth: 380, boxShadow: 'var(--sh-shadow-lg)' }}>
            <h3 className="text-h3" style={{ marginTop: 0 }}>{t('book_detail.delete_confirm_title')}</h3>
            <p className="text-p" style={{ marginBottom: 24 }}>{t('book_detail.delete_confirm_body')}</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                className="sh-btn-secondary"
              >
                {t('book_detail.delete_cancel')}
              </button>
              <button
                onClick={() => {
                  deleteMutation.mutate(book.id, {
                    onSuccess: () => navigate(ROUTES.books),
                  })
                }}
                className="sh-btn-primary"
                style={{ background: 'var(--sh-red)' }}
              >
                {deleteMutation.isPending ? t('book_detail.deleting') : t('book_detail.delete_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
