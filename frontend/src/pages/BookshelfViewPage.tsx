import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { EmptyShelfIcon } from '../components/EmptyStateIcons'
import { useBooks } from '../hooks/useBooks'
import { useLocations } from '../hooks/useLocations'
import { ROUTES, getBookDetailRoute } from '../lib/routes'
import { LocationsPage } from './LocationsPage'
import type { Book, Location } from '../lib/types'

export function BookshelfViewPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const { data: locations = [] } = useLocations()
  const { data: booksData } = useBooks({ pageSize: 100 })
  const allBooks = booksData?.items ?? []

  const preselectedLocationId = searchParams.get('location_id')
  const highlightBookId = searchParams.get('highlight_book_id')
  const activeTab = searchParams.get('tab') === 'locations' ? 'locations' : 'shelves'
  const highlightSpineRef = useRef<HTMLButtonElement | null>(null)

  const locationTree = useMemo(() => {
    const tree: Record<string, Record<string, Location[]>> = {}
    for (const loc of locations) {
      if (!tree[loc.room]) tree[loc.room] = {}
      if (!tree[loc.room][loc.furniture]) tree[loc.room][loc.furniture] = []
      tree[loc.room][loc.furniture].push(loc)
    }
    for (const room of Object.values(tree)) {
      for (const furniture of Object.keys(room)) {
        room[furniture].sort(
          (a, b) =>
            ((a.display_order ?? 0) - (b.display_order ?? 0))
            || a.shelf.localeCompare(b.shelf, undefined, { numeric: true }),
        )
      }
    }
    return tree
  }, [locations])

  const booksByLocation = useMemo(() => {
    const map: Record<string, Book[]> = {}
    for (const book of allBooks) {
      if (!book.location_id) continue
      if (!map[book.location_id]) map[book.location_id] = []
      map[book.location_id].push(book)
    }
    for (const books of Object.values(map)) {
      books.sort((a, b) => (a.shelf_position ?? 999) - (b.shelf_position ?? 999))
    }
    return map
  }, [allBooks])

  const [selectedRoom, setSelectedRoom] = useState<string>('')

  const roomNames = Object.keys(locationTree)
  const filteredTree = selectedRoom ? { [selectedRoom]: locationTree[selectedRoom] } : locationTree

  useEffect(() => {
    if (!highlightBookId || activeTab !== 'shelves') return
    const timer = setTimeout(() => {
      highlightSpineRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }, 80)
    return () => clearTimeout(timer)
  }, [highlightBookId, activeTab, filteredTree])

  return (
    <div className="container" style={{ margin: '0 auto', width: '100%', maxWidth: 960 }}>
      <div className="sh-page-header">
        <button
          onClick={() => navigate(ROUTES.books)}
          className="sh-back-btn hover-lift"
        >
          ←
        </button>
        <h2 className="text-h2" style={{ marginBottom: 0 }}>{t('bookshelf.title')}</h2>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => navigate(ROUTES.scanShelf)}
          className="sh-btn-primary hover-scale"
          style={{ padding: '10px 20px', fontSize: 14 }}
        >
          + {t('bookshelf.scan_shelf')}
        </button>
      </div>

      <div className="sh-underline-tabs" style={{ marginBottom: 24 }}>
        <button
          type='button'
          className={`sh-underline-tab${activeTab === 'shelves' ? ' sh-underline-tab--active' : ''}`}
          onClick={() => navigate(ROUTES.bookshelfView)}
        >
          {t('bookshelf.tab_shelves')}
        </button>
        <button
          type='button'
          className={`sh-underline-tab${activeTab === 'locations' ? ' sh-underline-tab--active' : ''}`}
          onClick={() => navigate(`${ROUTES.bookshelfView}?tab=locations`)}
        >
          {t('bookshelf.tab_locations')}
        </button>
      </div>

      {activeTab === 'locations' ? (
        <LocationsPage />
      ) : (<>
        {roomNames.length > 1 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
            <button
              onClick={() => setSelectedRoom('')}
              className={`sh-pill${!selectedRoom ? ' sh-pill--active' : ''}`}
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              {t('tabs.all')}
            </button>
            {roomNames.map(room => (
              <button
                key={room}
                onClick={() => setSelectedRoom(room)}
                className={`sh-pill${selectedRoom === room ? ' sh-pill--active' : ''}`}
                style={{ padding: '8px 16px', fontSize: 13 }}
              >
                {room}
              </button>
            ))}
          </div>
        )}

        {Object.keys(filteredTree).length === 0 && (
          <div className="sh-empty-state" style={{ padding: 60 }}>
            <div className="sh-empty-state__icon">
              <EmptyShelfIcon size={56} />
            </div>
            <h3 className="text-h3">{t('bookshelf.empty_title')}</h3>
            <p className="text-small">{t('bookshelf.empty_desc')}</p>
          </div>
        )}

        {Object.entries(filteredTree).map(([room, furnitureMap]) => (
          <div key={room} style={{ marginBottom: 40 }}>
            <h3 className="text-h3" style={{ marginBottom: 16, color: 'var(--sh-text-main)' }}>{room}</h3>

            {Object.entries(furnitureMap).map(([furniture, shelfLocations]) => (
              <div
                key={furniture}
                className="sh-card-panel"
                style={{ marginBottom: 24, borderRadius: 'var(--sh-radius-lg)', overflow: 'hidden' }}
              >
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sh-border)', background: 'var(--sh-bg)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18 }}>📖</span>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{furniture}</span>
                  <span style={{ fontSize: 12, color: 'var(--sh-text-muted)', marginLeft: 4 }}>
                    ({shelfLocations.reduce((sum, loc) => sum + (booksByLocation[loc.id]?.length ?? 0), 0)} {t('bookshelf.books_count')})
                  </span>
                </div>

                {shelfLocations.map((loc) => {
                  const shelfBooks = booksByLocation[loc.id] ?? []
                  const isHighlighted = preselectedLocationId === loc.id

                  return (
                    <div
                      key={loc.id}
                      style={{ borderBottom: '1px solid var(--sh-border)', padding: '12px 16px', background: isHighlighted ? 'var(--sh-teal-bg)' : undefined, transition: 'background 0.3s' }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--sh-text-muted)', marginBottom: 8 }}>
                        {loc.shelf}
                      </div>

                      {shelfBooks.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--sh-text-muted)', fontStyle: 'italic', padding: '8px 0' }}>
                          {t('bookshelf.empty_shelf')}
                        </div>
                      ) : (
                        <div style={{
                          display: 'flex',
                          gap: 5,
                          overflowX: 'auto',
                          paddingBottom: 0,
                          paddingTop: 4,
                          alignItems: 'flex-end',
                          borderBottom: '3px solid var(--sh-border-2)',
                          backgroundImage: 'linear-gradient(to top, var(--sh-surface-elevated) 3px, transparent 3px)',
                        }}>
                          {shelfBooks.map((book) => (
                            <BookSpine
                              key={book.id}
                              book={book}
                              highlighted={highlightBookId === book.id}
                              focusRef={highlightBookId === book.id ? highlightSpineRef : undefined}
                              onClick={() => navigate(getBookDetailRoute(book.id))}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        ))}

        <div style={{ height: 80 }} />
      </>)}
    </div>
  )
}

function BookSpine({ book, onClick, highlighted = false, focusRef }: { book: Book; onClick: () => void; highlighted?: boolean; focusRef?: RefObject<HTMLButtonElement | null> }) {
  const hasCover = Boolean(book.cover_image_url)

  const color = useMemo(() => {
    const colors = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2', '#4f46e5', '#be185d', '#0d9488', '#6d28d9', '#c2410c', '#0369a1']
    let hash = 0
    for (let i = 0; i < book.title.length; i++) hash = book.title.charCodeAt(i) + ((hash << 5) - hash)
    return colors[Math.abs(hash) % colors.length]
  }, [book.title])

  const displayTitle = book.title.length > 40 ? `${book.title.slice(0, 38)}…` : book.title

  return (
    <button
      ref={focusRef}
      onClick={onClick}
      className="sh-book-spine"
      title={`${book.title}${book.author ? ` — ${book.author}` : ''}`}
      data-highlighted={highlighted ? '' : undefined}
      style={{
        minWidth: 44,
        maxWidth: 56,
        height: 150,
        background: hasCover ? 'var(--sh-surface)' : color,
        borderRadius: '2px 3px 3px 2px',
        border: highlighted ? '2px solid var(--sh-teal)' : (hasCover ? '1px solid var(--sh-border)' : 'none'),
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: hasCover ? 0 : '6px 3px',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: highlighted
          ? '0 0 0 3px var(--sh-border-focus), 2px 4px 10px rgba(0,0,0,0.2)'
          : '1px 1px 3px rgba(0,0,0,0.12), inset -1px 0 2px rgba(0,0,0,0.08)',
        flexShrink: 0,
      }}
    >
      {hasCover ? (
        <img
          src={book.cover_image_url ?? ''}
          alt={book.title}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          loading='lazy'
        />
      ) : (
        <span style={{
          writingMode: 'vertical-rl',
          textOrientation: 'mixed',
          color: 'white',
          fontSize: 10,
          fontWeight: 600,
          lineHeight: 1.15,
          textAlign: 'center',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxHeight: '100%',
          letterSpacing: '0.01em',
          textShadow: '0 1px 2px rgba(0,0,0,0.3)',
        }}>
          {displayTitle}
        </span>
      )}
    </button>
  )
}
