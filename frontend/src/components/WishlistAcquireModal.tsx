import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { useCreateBook } from '../hooks/useBooks'
import { useLocations } from '../hooks/useLocations'
import { useDeleteWishlistItem } from '../hooks/useWishlist'
import { useToastStore } from '../lib/toast-store'
import type { BookCreateRequest, ReadingStatus, WishlistItem } from '../lib/types'
import { Modal } from './Modal'

interface WishlistAcquireModalProps {
  wish: WishlistItem
  onClose: () => void
}

/**
 * "Acquired" flow: turn a wish into a real book. Prefills the create
 * payload from the wish (title/author editable; ISBN, year and cover ride
 * along silently), lets the user pick a location + reading status, and on
 * success removes the wish. Create and delete are two calls — if the wish
 * removal fails the book already exists, so we surface a soft warning
 * instead of rolling anything back.
 */
export function WishlistAcquireModal({ wish, onClose }: WishlistAcquireModalProps) {
  const { t } = useTranslation()
  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)
  const { data: locations = [] } = useLocations()
  const createBookMutation = useCreateBook()
  const deleteWishMutation = useDeleteWishlistItem()

  const [title, setTitle] = useState(wish.title)
  const [author, setAuthor] = useState(wish.author ?? '')
  const [reading, setReading] = useState<ReadingStatus>('unread')

  // Three-level location picker — same cascade as AddBookPage.
  const [selRoom, setSelRoom] = useState('')
  const [selFurniture, setSelFurniture] = useState('')
  const [selShelf, setSelShelf] = useState('')

  const rooms = [...new Set(locations.map((l) => l.room))]
  const furnitures = [...new Set(locations.filter((l) => l.room === selRoom).map((l) => l.furniture))]
  const shelves = [...new Set(locations.filter((l) => l.room === selRoom && l.furniture === selFurniture).map((l) => l.shelf))]
  const resolvedId =
    locations.find((l) => l.room === selRoom && l.furniture === selFurniture && l.shelf === selShelf)?.id ?? null

  const isPending = createBookMutation.isPending || deleteWishMutation.isPending

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    const payload: BookCreateRequest = {
      title: title.trim(),
      author: author.trim() || null,
      isbn: wish.isbn,
      publication_year: wish.publication_year,
      cover_image_url: wish.cover_image_url,
      location_id: resolvedId,
      reading_status: reading,
    }
    createBookMutation.mutate(payload, {
      onSuccess: () => {
        deleteWishMutation.mutate(wish.id, {
          onSuccess: () => {
            showSuccess(t('wishlist.acquire_success'))
            onClose()
          },
          onError: () => {
            // The book was created; only the wish cleanup failed.
            showError(t('wishlist.acquire_cleanup_error'))
            onClose()
          },
        })
      },
      onError: () => showError(t('wishlist.acquire_error')),
    })
  }

  const fieldLabelStyle = {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--sh-text-main)',
    display: 'block',
    marginBottom: 6,
  } as const

  return (
    <Modal open onClose={onClose} label={t('wishlist.acquire_title')} size="md">
      <h3 className="text-h3" style={{ marginTop: 0 }}>{t('wishlist.acquire_title')}</h3>
      <p className="text-p" style={{ marginTop: 4, marginBottom: 16, color: 'var(--sh-text-muted)' }}>
        {t('wishlist.acquire_subtitle')}
      </p>

      <form onSubmit={handleSubmit} data-testid="wishlist-acquire-form" style={{ display: 'grid', gap: 14 }}>
        <div>
          <label style={fieldLabelStyle}>
            {t('wishlist.title_label')} <span style={{ color: 'var(--sh-red)' }}>*</span>
          </label>
          <input
            className="sh-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="acquire-title-input"
            required
          />
        </div>

        <div>
          <label style={fieldLabelStyle}>{t('wishlist.author_label')}</label>
          <input
            className="sh-input"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            data-testid="acquire-author-input"
          />
        </div>

        <div>
          <label style={fieldLabelStyle}>
            {t('add_book.location_label')}{' '}
            <span style={{ color: 'var(--sh-text-muted)', fontWeight: 400 }}>
              ({t('add_book.location_optional')})
            </span>
          </label>
          <div className="sh-location-grid">
            <select
              className="sh-select"
              value={selRoom}
              aria-label={t('add_book.room_label')}
              onChange={(e) => { setSelRoom(e.target.value); setSelFurniture(''); setSelShelf('') }}
            >
              <option value="">{t('add_book.no_room_option')}</option>
              {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select
              className="sh-select"
              value={selFurniture}
              aria-label={t('add_book.furniture_label')}
              disabled={!selRoom}
              onChange={(e) => { setSelFurniture(e.target.value); setSelShelf('') }}
            >
              <option value="">{t('add_book.no_furniture_option')}</option>
              {furnitures.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select
              className="sh-select"
              value={selShelf}
              aria-label={t('add_book.shelf_label')}
              disabled={!selFurniture}
              onChange={(e) => setSelShelf(e.target.value)}
            >
              <option value="">{t('add_book.no_shelf_option')}</option>
              {shelves.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label style={fieldLabelStyle}>{t('add_book.status_label')}</label>
          <select
            className="sh-select"
            value={reading}
            aria-label={t('add_book.status_label')}
            onChange={(e) => setReading(e.target.value as ReadingStatus)}
          >
            <option value="unread">{t('reading_status.unread')}</option>
            <option value="reading">{t('reading_status.reading')}</option>
            <option value="read">{t('reading_status.read')}</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" className="sh-btn-secondary" onClick={onClose} disabled={isPending}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="sh-btn-primary"
            data-testid="acquire-submit"
            disabled={isPending || !title.trim()}
          >
            {isPending ? t('wishlist.acquiring') : t('wishlist.acquire_submit')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
