import { useEffect, useMemo, useRef, useState } from 'react'
import { useBooks, useDeleteBook, useJobStatus } from '../hooks/useBooks'
import { useLocations } from '../hooks/useLocations'
import { useToastStore } from '../lib/toast-store'
import { BookCard } from '../components/BookCard'
import { ShelfBreadcrumb } from '../components/ShelfBreadcrumb'
import { StatBar } from '../components/StatBar'
import type { Book, Location } from '../lib/types'

const PAGE_SIZE = 20

export function BooksPage() {
  const [searchInput, setSearchInput]         = useState('')
  const [search, setSearch]                   = useState('')
  const [page, setPage]                       = useState(1)
  const [deleteTargetId, setDeleteTargetId]   = useState<string | null>(null)
  const [uploadJobId, setUploadJobId]         = useState<string | null>(null)
  const toastedFailedIdsRef                   = useRef<Set<string>>(new Set())

  const queryParams = useMemo(
    () => ({ page, pageSize: PAGE_SIZE, search: search || undefined }),
    [page, search],
  )

  const booksQuery          = useBooks(queryParams)
  const locationsQuery      = useLocations()
  const deleteMutation      = useDeleteBook()
  const uploadJobStatusQuery = useJobStatus(uploadJobId)
  const showError           = useToastStore(s => s.showError)

  // Map locationId → Location object
  const locationById = useMemo(() => {
    const m = new Map<string, Location>()
    for (const loc of locationsQuery.data ?? []) m.set(loc.id, loc)
    return m
  }, [locationsQuery.data])

  // Group books by location
  const groups = useMemo(() => {
    const map = new Map<string | null, Book[]>()
    for (const b of booksQuery.data?.items ?? []) {
      const key = b.location_id ?? null
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(b)
    }
    return map
  }, [booksQuery.data?.items])

  // Toast for failed processing
  useEffect(() => {
    const failed = (booksQuery.data?.items ?? []).filter(
      b => b.processing_status === 'failed' && !toastedFailedIdsRef.current.has(b.id),
    )
    if (!failed.length) return
    for (const b of failed) toastedFailedIdsRef.current.add(b.id)
    showError(`Zpracování selhalo pro ${failed.length} knih: ${failed.map(b => `"${b.title}"`).join(', ')}`)
  }, [booksQuery.data?.items, showError])

  // Upload job polling
  useEffect(() => {
    const status = uploadJobStatusQuery.data?.status
    if (status === 'done' || status === 'failed') {
      if (status === 'failed') showError(uploadJobStatusQuery.data?.error_message ?? 'Zpracování obrázku selhalo.')
      setUploadJobId(null)
      void booksQuery.refetch()
    }
    if (uploadJobStatusQuery.isError) {
      showError('Nepodařilo se zkontrolovat stav uploadu.')
    }
  }, [
    booksQuery,
    showError,
    uploadJobStatusQuery.data?.error_message,
    uploadJobStatusQuery.data?.status,
    uploadJobStatusQuery.isError,
  ])

  const books = booksQuery.data?.items ?? []
  const total = booksQuery.data?.total ?? 0

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '16px 16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500 }}>Shelfy</h1>
          <p style={{ fontSize: 13, color: '#888' }}>{total} knih</p>
        </div>
      </div>

      {/* Stat bar */}
      <StatBar books={books} total={total} />

      {/* Search */}
      <form
        aria-label="book-search-form"
        onSubmit={e => { e.preventDefault(); setPage(1); setSearch(searchInput.trim()) }}
        style={{ margin: '12px 16px 0', display: 'flex', gap: 8 }}
      >
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: '#F7F7F5',
          border: '0.5px solid rgba(0,0,0,0.10)',
          borderRadius: 12,
          padding: '10px 14px',
        }}>
          <span style={{ fontSize: 16, color: '#888' }}>⌕</span>
          <input
            aria-label="Search books"
            placeholder="Hledat knihy, autory..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 14, outline: 'none' }}
          />
        </div>
        <button
          type="submit"
          style={{
            padding: '0 16px',
            background: '#1D9E75',
            color: 'white',
            border: 'none',
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Hledat
        </button>
      </form>

      {/* Upload status */}
      {uploadJobId && (
        <p style={{ margin: '8px 16px', fontSize: 13, color: '#BA7517' }}>
          ⏳ Zpracovávám obrázek… ({uploadJobStatusQuery.data?.status ?? 'pending'})
        </p>
      )}

      {/* Book groups */}
      <div style={{ padding: '14px 16px 0' }}>
        {booksQuery.isLoading && <p style={{ color: '#888', fontSize: 14 }}>Načítám knihy…</p>}
        {booksQuery.isError && (
          <p style={{ color: '#E24B4A', fontSize: 14 }}>
            Nepodařilo se načíst knihy.{' '}
            <button onClick={() => void booksQuery.refetch()} style={{ color: '#1D9E75', background: 'none', border: 'none', cursor: 'pointer' }}>
              Zkusit znovu
            </button>
          </p>
        )}
        {!booksQuery.isLoading && !booksQuery.isError && total === 0 && (
          <p style={{ color: '#888', fontSize: 14 }}>Žádné knihy nenalezeny.</p>
        )}

        {Array.from(groups.entries()).map(([locId, groupBooks]) => {
          const loc = locId ? locationById.get(locId) : null
          return (
            <div key={locId ?? 'unassigned'} style={{ marginBottom: 18 }}>
              {loc
                ? <ShelfBreadcrumb location={loc} />
                : <p style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>Bez umístění</p>
              }
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {groupBooks.map(b => <BookCard key={b.id} book={b} onDelete={setDeleteTargetId} />)}
              </div>
            </div>
          )
        })}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 8 }}>
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              style={{ padding: '8px 16px', borderRadius: 8, border: '0.5px solid rgba(0,0,0,0.15)', background: 'none', cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.4 : 1 }}
            >
              ← Předchozí
            </button>
            <span style={{ fontSize: 13, color: '#888' }}>
              {page} / {Math.ceil(total / PAGE_SIZE)}
            </span>
            <button
              disabled={page >= Math.ceil(total / PAGE_SIZE)}
              onClick={() => setPage(p => p + 1)}
              style={{ padding: '8px 16px', borderRadius: 8, border: '0.5px solid rgba(0,0,0,0.15)', background: 'none', cursor: page >= Math.ceil(total / PAGE_SIZE) ? 'not-allowed' : 'pointer', opacity: page >= Math.ceil(total / PAGE_SIZE) ? 0.4 : 1 }}
            >
              Další →
            </button>
          </div>
        )}
      </div>

      {/* Delete dialog */}
      {deleteTargetId && (
        <div role="dialog" aria-label="delete-book-dialog" style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '0 24px',
        }}>
          <div style={{ background: 'white', borderRadius: 16, padding: '20px 20px 16px', width: '100%', maxWidth: 360 }}>
            <p style={{ fontSize: 15, marginBottom: 16 }}>Opravdu chceš smazat tuto knihu?</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteTargetId(null)} style={{ padding: '9px 18px', borderRadius: 8, border: '0.5px solid rgba(0,0,0,0.15)', background: 'none', cursor: 'pointer', fontSize: 14 }}>
                Zrušit
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTargetId, { onSuccess: () => setDeleteTargetId(null) })}
                style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#E24B4A', color: 'white', cursor: 'pointer', fontSize: 14 }}
              >
                {deleteMutation.isPending ? 'Mažu…' : 'Smazat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
