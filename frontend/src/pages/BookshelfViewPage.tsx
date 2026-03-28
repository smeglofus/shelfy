import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useBooks } from '../hooks/useBooks'
import { useLocations } from '../hooks/useLocations'
import { ROUTES, getBookDetailRoute } from '../lib/routes'
import type { Book, Location } from '../lib/types'

export function BookshelfViewPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const { data: locations = [] } = useLocations()
  const { data: booksData } = useBooks({ pageSize: 100 })
  const allBooks = booksData?.items ?? []

  const preselectedLocationId = searchParams.get('location_id')

  // Group locations by room > furniture
  const locationTree = useMemo(() => {
    const tree: Record<string, Record<string, Location[]>> = {}
    for (const loc of locations) {
      if (!tree[loc.room]) tree[loc.room] = {}
      if (!tree[loc.room][loc.furniture]) tree[loc.room][loc.furniture] = []
      tree[loc.room][loc.furniture].push(loc)
    }
    // Sort shelves within each furniture
    for (const room of Object.values(tree)) {
      for (const furniture of Object.keys(room)) {
        room[furniture].sort((a, b) => a.shelf.localeCompare(b.shelf, undefined, { numeric: true }))
      }
    }
    return tree
  }, [locations])

  // Group books by location_id
  const booksByLocation = useMemo(() => {
    const map: Record<string, Book[]> = {}
    for (const book of allBooks) {
      if (!book.location_id) continue
      if (!map[book.location_id]) map[book.location_id] = []
      map[book.location_id].push(book)
    }
    // Sort by shelf_position within each location
    for (const books of Object.values(map)) {
      books.sort((a, b) => (a.shelf_position ?? 999) - (b.shelf_position ?? 999))
    }
    return map
  }, [allBooks])

  // Filter state
  const [selectedRoom, setSelectedRoom] = useState<string>('')

  const roomNames = Object.keys(locationTree)
  const filteredTree = selectedRoom
    ? { [selectedRoom]: locationTree[selectedRoom] }
    : locationTree

  return (
    <div className="container" style={{ margin: '0 auto', width: '100%', maxWidth: 960 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <button
          onClick={() => navigate(ROUTES.books)}
          style={{ width: 40, height: 40, borderRadius: 'var(--sh-radius-md)', border: '1px solid var(--sh-border)', background: 'var(--sh-surface)', cursor: 'pointer', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          className="hover-lift"
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

      {/* Room filter */}
      {roomNames.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          <button
            onClick={() => setSelectedRoom('')}
            style={{
              padding: '8px 16px', borderRadius: 'var(--sh-radius-md)',
              border: '1px solid var(--sh-border)',
              background: !selectedRoom ? 'var(--sh-teal)' : 'var(--sh-surface)',
              color: !selectedRoom ? 'white' : 'var(--sh-text-main)',
              cursor: 'pointer', fontSize: 13, fontWeight: 500,
            }}
          >
            {t('tabs.all')}
          </button>
          {roomNames.map(room => (
            <button
              key={room}
              onClick={() => setSelectedRoom(room)}
              style={{
                padding: '8px 16px', borderRadius: 'var(--sh-radius-md)',
                border: '1px solid var(--sh-border)',
                background: selectedRoom === room ? 'var(--sh-teal)' : 'var(--sh-surface)',
                color: selectedRoom === room ? 'white' : 'var(--sh-text-main)',
                cursor: 'pointer', fontSize: 13, fontWeight: 500,
              }}
            >
              {room}
            </button>
          ))}
        </div>
      )}

      {/* Bookshelf visualization */}
      {Object.keys(filteredTree).length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--sh-text-muted)' }}>
          <p style={{ fontSize: 48, marginBottom: 16 }}>📚</p>
          <h3 className="text-h3">{t('bookshelf.empty_title')}</h3>
          <p className="text-small">{t('bookshelf.empty_desc')}</p>
        </div>
      )}

      {Object.entries(filteredTree).map(([room, furnitureMap]) => (
        <div key={room} style={{ marginBottom: 40 }}>
          <h3 className="text-h3" style={{ marginBottom: 16, color: 'var(--sh-text-main)' }}>
            {room}
          </h3>

          {Object.entries(furnitureMap).map(([furniture, shelfLocations]) => (
            <div
              key={furniture}
              style={{
                marginBottom: 24,
                background: 'var(--sh-surface)',
                border: '1px solid var(--sh-border)',
                borderRadius: 'var(--sh-radius-lg)',
                overflow: 'hidden',
              }}
            >
              {/* Furniture header */}
              <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--sh-border)',
                background: 'var(--sh-bg)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <span style={{ fontSize: 18 }}>📖</span>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{furniture}</span>
                <span style={{ fontSize: 12, color: 'var(--sh-text-muted)', marginLeft: 4 }}>
                  ({shelfLocations.reduce((sum, loc) => sum + (booksByLocation[loc.id]?.length ?? 0), 0)} {t('bookshelf.books_count')})
                </span>
              </div>

              {/* Shelves */}
              {shelfLocations.map((loc) => {
                const shelfBooks = booksByLocation[loc.id] ?? []
                const isHighlighted = preselectedLocationId === loc.id

                return (
                  <div
                    key={loc.id}
                    style={{
                      borderBottom: '1px solid var(--sh-border)',
                      padding: '12px 16px',
                      background: isHighlighted ? 'var(--sh-teal-bg)' : undefined,
                      transition: 'background 0.3s',
                    }}
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
                        gap: 6,
                        overflowX: 'auto',
                        paddingBottom: 4,
                      }}>
                        {shelfBooks.map((book) => (
                          <BookSpine key={book.id} book={book} onClick={() => navigate(getBookDetailRoute(book.id))} />
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
    </div>
  )
}


function BookSpine({ book, onClick }: { book: Book; onClick: () => void }) {
  // Generate a stable color from the title
  const color = useMemo(() => {
    const colors = [
      '#2563eb', '#7c3aed', '#db2777', '#ea580c',
      '#059669', '#0891b2', '#4f46e5', '#be185d',
      '#0d9488', '#6d28d9', '#c2410c', '#0369a1',
    ]
    let hash = 0
    for (let i = 0; i < book.title.length; i++) {
      hash = book.title.charCodeAt(i) + ((hash << 5) - hash)
    }
    return colors[Math.abs(hash) % colors.length]
  }, [book.title])

  const displayTitle = book.title.length > 30 ? book.title.slice(0, 28) + '…' : book.title

  return (
    <button
      onClick={onClick}
      title={`${book.title}${book.author ? ` – ${book.author}` : ''}`}
      style={{
        minWidth: 36,
        maxWidth: 52,
        height: 120,
        background: color,
        borderRadius: '2px 4px 4px 2px',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4px 2px',
        position: 'relative',
        boxShadow: '2px 2px 4px rgba(0,0,0,0.15), inset -1px 0 2px rgba(0,0,0,0.1)',
        transition: 'transform 0.15s, box-shadow 0.15s',
        flexShrink: 0,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-4px)'
        e.currentTarget.style.boxShadow = '2px 6px 12px rgba(0,0,0,0.2), inset -1px 0 2px rgba(0,0,0,0.1)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = '2px 2px 4px rgba(0,0,0,0.15), inset -1px 0 2px rgba(0,0,0,0.1)'
      }}
    >
      <span style={{
        writingMode: 'vertical-rl',
        textOrientation: 'mixed',
        color: 'white',
        fontSize: 9,
        fontWeight: 600,
        lineHeight: 1.2,
        textAlign: 'center',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxHeight: '100%',
        letterSpacing: '0.02em',
        textShadow: '0 1px 2px rgba(0,0,0,0.3)',
      }}>
        {displayTitle}
      </span>
    </button>
  )
}
