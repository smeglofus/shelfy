import { useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { WishlistAcquireModal } from '../components/WishlistAcquireModal'
import { useLibraries } from '../hooks/useLibrary'
import { useLibraryStore } from '../store/useLibraryStore'
import { MIN_SUGGEST_QUERY_LENGTH, useBookSuggestions } from '../hooks/useBookSuggestions'
import { useCreateWishlistItem, useDeleteWishlistItem, useWishlist } from '../hooks/useWishlist'
import { useDebounce } from '../hooks/useDebounce'
import { useToastStore } from '../lib/toast-store'
import type { BookSuggestion, WishlistItem, WishlistItemCreateRequest } from '../lib/types'

const PAGE_SIZE = 20

/** Metadata carried over silently from a picked suggestion (#308/#309). */
type SuggestionMeta = Pick<
  WishlistItemCreateRequest,
  'isbn' | 'publication_year' | 'cover_image_url'
>

export function WishlistPage() {
  const { t } = useTranslation()
  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)

  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId)
  const { data: libraries } = useLibraries()
  const activeLibrary =
    libraries?.find((lib) => lib.id === activeLibraryId) ?? libraries?.[0] ?? null
  const wishlistEnabled = activeLibrary?.wishlist_enabled ?? true
  const canEdit = activeLibrary != null && activeLibrary.role !== 'viewer'

  const [page, setPage] = useState(1)
  // Wait for the libraries payload before fetching — otherwise a library
  // with the wishlist disabled would fire one doomed (403) request during
  // the first render, while wishlistEnabled still holds its default.
  const wishlistQuery = useWishlist(page, PAGE_SIZE, libraries !== undefined && wishlistEnabled)
  const createMutation = useCreateWishlistItem()
  const deleteMutation = useDeleteWishlistItem()

  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [note, setNote] = useState('')

  /* "Acquired" flow: wish → real book with a location (modal). */
  const [acquireWish, setAcquireWish] = useState<WishlistItem | null>(null)

  /* Catalogue autocomplete on the title field — reuses the #308 suggester. */
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const [suggestMeta, setSuggestMeta] = useState<SuggestionMeta | null>(null)
  const debouncedTitle = useDebounce(title, 250)
  const suggestionsQuery = useBookSuggestions(debouncedTitle, suggestOpen)
  const suggestions = suggestionsQuery.data ?? []
  const listboxVisible = suggestOpen && suggestions.length > 0

  function handleTitleChange(e: ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    setTitle(value)
    setSuggestMeta(null)
    setActiveSuggestion(-1)
    setSuggestOpen(value.trim().length >= MIN_SUGGEST_QUERY_LENGTH)
  }

  function applySuggestion(suggestion: BookSuggestion) {
    setTitle(suggestion.title)
    setAuthor(suggestion.author ?? '')
    setSuggestMeta({
      isbn: suggestion.isbn,
      publication_year: suggestion.publication_year,
      cover_image_url: suggestion.cover_image_url,
    })
    setSuggestOpen(false)
    setActiveSuggestion(-1)
  }

  function handleTitleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      if (listboxVisible) {
        e.preventDefault()
        setSuggestOpen(false)
        setActiveSuggestion(-1)
      }
      return
    }
    if (!listboxVisible) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveSuggestion((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveSuggestion((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      if (activeSuggestion >= 0 && activeSuggestion < suggestions.length) {
        e.preventDefault()
        applySuggestion(suggestions[activeSuggestion])
      }
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    const payload: WishlistItemCreateRequest = {
      title: title.trim(),
      author: author.trim() || null,
      note: note.trim() || null,
      ...(suggestMeta ?? {}),
    }
    createMutation.mutate(payload, {
      onSuccess: () => {
        setTitle('')
        setAuthor('')
        setNote('')
        setSuggestMeta(null)
        showSuccess(t('wishlist.add_success'))
      },
      onError: () => showError(t('wishlist.add_error')),
    })
  }

  function handleDelete(itemId: string) {
    deleteMutation.mutate(itemId, {
      onSuccess: () => showSuccess(t('wishlist.delete_success')),
      onError: () => showError(t('wishlist.delete_error')),
    })
  }

  const data = wishlistQuery.data
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <main className="sh-main" style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 className="text-h2" style={{ margin: 0 }}>{t('wishlist.title')}</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--sh-text-muted)' }}>
          {t('wishlist.subtitle')}
        </p>
      </header>

      {!wishlistEnabled && (
        <p data-testid="wishlist-disabled" style={{ color: 'var(--sh-text-muted)' }}>
          {t('wishlist.disabled_notice')}
        </p>
      )}

      {wishlistEnabled && canEdit && (
        <form
          onSubmit={handleSubmit}
          aria-label={t('wishlist.form_label')}
          data-testid="wishlist-form"
          style={{
            display: 'grid',
            gap: 12,
            marginBottom: 24,
            padding: 16,
            border: '1px solid var(--sh-border)',
            borderRadius: 'var(--sh-radius-md)',
            background: 'var(--sh-surface)',
          }}
        >
          <div style={{ position: 'relative' }}>
            <label id="wishlist-title-label" style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
              {t('wishlist.title_label')} <span style={{ color: 'var(--sh-red)' }}>*</span>
            </label>
            <input
              className="sh-input"
              placeholder={t('wishlist.title_placeholder')}
              value={title}
              onChange={handleTitleChange}
              onKeyDown={handleTitleKeyDown}
              onBlur={() => { setSuggestOpen(false); setActiveSuggestion(-1) }}
              role="combobox"
              aria-expanded={listboxVisible}
              aria-controls="wishlist-title-suggestions"
              aria-autocomplete="list"
              aria-labelledby="wishlist-title-label"
              aria-activedescendant={
                listboxVisible && activeSuggestion >= 0
                  ? `wishlist-suggestion-${activeSuggestion}`
                  : undefined
              }
              data-testid="wishlist-title-input"
              required
            />
            {listboxVisible && (
              <ul
                id="wishlist-title-suggestions"
                role="listbox"
                aria-label={t('add_book.suggestions_label')}
                data-testid="wishlist-suggestions"
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  zIndex: 30,
                  margin: '4px 0 0',
                  padding: 4,
                  listStyle: 'none',
                  maxHeight: 280,
                  overflowY: 'auto',
                  background: 'var(--sh-surface)',
                  border: '1px solid var(--sh-border)',
                  borderRadius: 'var(--sh-radius-md)',
                  boxShadow: 'var(--sh-shadow-lg)',
                }}
              >
                {suggestions.map((suggestion, index) => (
                  <li
                    key={`${suggestion.title}-${suggestion.isbn ?? index}`}
                    id={`wishlist-suggestion-${index}`}
                    role="option"
                    aria-selected={index === activeSuggestion}
                    data-testid={`wishlist-suggestion-${index}`}
                    onMouseDown={(e) => { e.preventDefault(); applySuggestion(suggestion) }}
                    onMouseEnter={() => setActiveSuggestion(index)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 'var(--sh-radius-sm, 6px)',
                      cursor: 'pointer',
                      background: index === activeSuggestion ? 'var(--sh-teal-bg)' : 'transparent',
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sh-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {suggestion.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--sh-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[suggestion.author, suggestion.publication_year].filter(Boolean).join(' · ')}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="md-grid-2">
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                {t('wishlist.author_label')}
              </label>
              <input
                className="sh-input"
                placeholder={t('wishlist.author_placeholder')}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                data-testid="wishlist-author-input"
              />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                {t('wishlist.note_label')}
              </label>
              <input
                className="sh-input"
                placeholder={t('wishlist.note_placeholder')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-testid="wishlist-note-input"
              />
            </div>
          </div>

          <button
            type="submit"
            className="sh-btn-primary"
            disabled={createMutation.isPending || !title.trim()}
            data-testid="wishlist-submit"
            style={{ justifySelf: 'start' }}
          >
            {createMutation.isPending ? t('wishlist.adding') : t('wishlist.add_button')}
          </button>
        </form>
      )}

      {wishlistEnabled && wishlistQuery.isLoading && (
        <p data-testid="wishlist-loading" style={{ color: 'var(--sh-text-muted)' }}>
          {t('wishlist.loading')}
        </p>
      )}

      {wishlistEnabled && data !== undefined && total === 0 && (
        <p data-testid="wishlist-empty" style={{ color: 'var(--sh-text-muted)' }}>
          {t('wishlist.empty')}
        </p>
      )}

      {wishlistEnabled && items.length > 0 && (
        <ul
          data-testid="wishlist-list"
          style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}
        >
          {items.map((item) => (
            <li
              key={item.id}
              data-testid={`wishlist-item-${item.id}`}
              className="sh-card"
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                padding: 12,
                border: '1px solid var(--sh-border)',
                borderRadius: 'var(--sh-radius-md)',
                background: 'var(--sh-surface)',
              }}
            >
              {item.cover_image_url && (
                <img
                  src={item.cover_image_url}
                  alt=""
                  loading="lazy"
                  style={{ width: 40, height: 56, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.title}
                  {item.publication_year && (
                    <span style={{ marginLeft: 6, fontWeight: 400, fontSize: 12, color: 'var(--sh-text-muted)' }}>
                      ({item.publication_year})
                    </span>
                  )}
                </div>
                {item.author && (
                  <div style={{ fontSize: 13, color: 'var(--sh-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.author}
                  </div>
                )}
                {item.note && (
                  <div style={{ fontSize: 12, color: 'var(--sh-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.note}
                  </div>
                )}
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    className="sh-btn-primary"
                    data-testid={`wishlist-acquire-${item.id}`}
                    aria-label={t('wishlist.acquire_label', { title: item.title })}
                    onClick={() => setAcquireWish(item)}
                    style={{ fontSize: 12 }}
                  >
                    {t('wishlist.acquire_button')}
                  </button>
                  <button
                    type="button"
                    className="sh-btn-secondary"
                    data-testid={`wishlist-delete-${item.id}`}
                    aria-label={t('wishlist.delete_label', { title: item.title })}
                    disabled={deleteMutation.isPending}
                    onClick={() => handleDelete(item.id)}
                    style={{ fontSize: 12, color: 'var(--sh-red)' }}
                  >
                    {t('wishlist.delete_button')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {acquireWish && (
        <WishlistAcquireModal wish={acquireWish} onClose={() => setAcquireWish(null)} />
      )}

      {wishlistEnabled && totalPages > 1 && (
        <nav
          aria-label={t('wishlist.pagination_label')}
          data-testid="wishlist-paginator"
          style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}
        >
          <button
            type="button"
            className="sh-btn-secondary"
            data-testid="wishlist-prev-page"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t('wishlist.prev_page')}
          </button>
          <span style={{ color: 'var(--sh-text-muted)', fontSize: 13 }}>
            {t('wishlist.page_indicator', { page, total: totalPages })}
          </span>
          <button
            type="button"
            className="sh-btn-secondary"
            data-testid="wishlist-next-page"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            {t('wishlist.next_page')}
          </button>
        </nav>
      )}
    </main>
  )
}
