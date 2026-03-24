import { useEffect, useMemo, useRef, useState } from 'react'
import { useBooks, useDeleteBook, useJobStatus } from '../hooks/useBooks'
import { useLocations } from '../hooks/useLocations'
import { useToastStore } from '../lib/toast-store'
import { BookCard } from '../components/BookCard'
import { ShelfBreadcrumb } from '../components/ShelfBreadcrumb'
import { StatBar } from '../components/StatBar'
import type { Book, Location, ReadingStatus } from '../lib/types'

const PAGE_SIZE = 20

const TAB_ITEMS: { label: string; value: ReadingStatus | null }[] = [
  { label: 'Vše', value: null },
  { label: 'Čtu', value: 'reading' },
  { label: 'Přečteno', value: 'read' },
  { label: 'Půjčeno', value: 'lent' },
  { label: 'Nepřečteno', value: 'unread' },
]

export function BooksPage() {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [uploadJobId, setUploadJobId] = useState<string | null>(null)
  const [readingFilter, setReadingFilter] = useState<ReadingStatus | null>(null)
  const toastedFailedIdsRef = useRef<Set<string>>(new Set())

  const queryParams = useMemo(
    () => ({ page, pageSize: PAGE_SIZE, search: search || undefined, readingStatus: readingFilter ?? undefined }),
    [page, search, readingFilter],
  )

  const booksQuery = useBooks(queryParams)
  const locationsQuery = useLocations()
  const deleteMutation = useDeleteBook()
  const uploadJobStatusQuery = useJobStatus(uploadJobId)
  const showError = useToastStore((s) => s.showError)

  const locationById = useMemo(() => {
    const m = new Map<string, Location>()
    for (const loc of locationsQuery.data ?? []) m.set(loc.id, loc)
    return m
  }, [locationsQuery.data])

  useEffect(() => {
    const failed = (booksQuery.data?.items ?? []).filter(
      (b) => b.processing_status === 'failed' && !toastedFailedIdsRef.current.has(b.id),
    )
    if (!failed.length) return
    for (const b of failed) toastedFailedIdsRef.current.add(b.id)
    showError(`Zpracování selhalo pro ${failed.length} knih: ${failed.map((b) => `"${b.title}"`).join(', ')}`)
  }, [booksQuery.data?.items, showError])

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

  const books = useMemo(() => booksQuery.data?.items ?? [], [booksQuery.data?.items])

  const groups = useMemo(() => {
    const map = new Map<string | null, Book[]>()
    for (const b of books) {
      const key = b.location_id ?? null
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(b)
    }
    return map
  }, [books])

  const total = booksQuery.data?.total ?? 0

  return (
    <div>
      <div style={{ padding: '24px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="text-h1">Moje Knihovna</h1>
          <p className="text-p">{total} {total === 1 ? 'kniha' : (total > 1 && total < 5) ? 'knihy' : 'knih'}</p>
        </div>
      </div>

      <div style={{ padding: '0 8px' }}>
        <StatBar books={books} total={total} />
      </div>

      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '12px 24px 0', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {TAB_ITEMS.map((tab) => {
          const isActive = readingFilter === tab.value
          return (
            <button
              key={tab.label}
              type="button"
              onClick={() => {
                setReadingFilter(tab.value)
                setPage(1)
              }}
              style={{
                padding: '8px 18px',
                borderRadius: 'var(--sh-radius-pill)',
                fontSize: 14,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                border: isActive ? 'none' : '1.5px solid var(--sh-border)',
                cursor: 'pointer',
                background: isActive ? 'var(--sh-teal)' : 'transparent',
                color: isActive ? 'white' : 'var(--sh-text-muted)',
                transition: 'all 0.2s ease',
                boxShadow: isActive ? '0 4px 12px rgba(15,157,88,0.2)' : 'none',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <form
        aria-label="book-search-form"
        onSubmit={(e) => {
          e.preventDefault()
          setPage(1)
          setSearch(searchInput.trim())
        }}
        style={{ margin: '20px 24px 0', display: 'flex', gap: 12 }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'var(--sh-surface)',
            border: '1.5px solid var(--sh-border)',
            borderRadius: 'var(--sh-radius-md)',
            padding: '4px 16px',
            transition: 'border-color 0.2s, box-shadow 0.2s',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--sh-teal)'
            e.currentTarget.style.boxShadow = '0 0 0 4px var(--sh-border-focus)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--sh-border)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        >
          <span style={{ fontSize: 18, color: 'var(--sh-text-muted)' }}>⌕</span>
          <input
            aria-label="Search books"
            placeholder="Hledat knihy, autory..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 15, fontFamily: "'Outfit', sans-serif", outline: 'none', padding: '10px 0', color: 'var(--sh-text-main)' }}
          />
        </div>
        <button
          type="submit"
          className="sh-btn-primary"
          style={{ padding: '0 20px', borderRadius: 'var(--sh-radius-md)' }}
        >
          Hledat
        </button>
      </form>

      {uploadJobId && (
        <p style={{ margin: '16px 24px', fontSize: 14, color: 'var(--sh-amber)', fontWeight: 500, background: 'var(--sh-amber-bg)', padding: '12px 16px', borderRadius: 'var(--sh-radius-md)' }}>
          ⏳ Zpracovávám obrázek… ({uploadJobStatusQuery.data?.status ?? 'pending'})
        </p>
      )}

      <div style={{ padding: '24px 24px 0' }}>
        {booksQuery.isLoading && <p className="text-p">Načítám knihy…</p>}

        {booksQuery.isError && (
          <p style={{ color: 'var(--sh-red)', fontSize: 15, fontWeight: 500 }}>
            Nepodařilo se načíst knihy.{' '}
            <button
              onClick={() => void booksQuery.refetch()}
              className="sh-btn-secondary"
              style={{ marginLeft: 12, background: 'var(--sh-red-bg)', color: 'var(--sh-red-text)' }}
            >
              Zkusit znovu
            </button>
          </p>
        )}

        {!booksQuery.isLoading && !booksQuery.isError && total === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 24px', color: 'var(--sh-text-muted)' }}>
            <div style={{ fontSize: 64, marginBottom: 20 }}>📚</div>
            <p className="text-h3" style={{ color: 'var(--sh-text-main)', marginTop: 0 }}>Žádné knihy</p>
            <p className="text-p">
              {search ? `Nic nenalezeno pro „${search}"` : 'Přidej svou první knihu tlačítkem ↓'}
            </p>
          </div>
        )}

        {!booksQuery.isLoading && !booksQuery.isError && total > 0 && readingFilter && books.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 24px', color: 'var(--sh-text-muted)' }}>
            <div style={{ fontSize: 56, marginBottom: 20 }}>🔍</div>
            <p className="text-h3" style={{ color: 'var(--sh-text-main)', marginTop: 0 }}>
              Žádné knihy v této kategorii
            </p>
          </div>
        )}

        {Array.from(groups.entries()).map(([locId, groupBooks]) => {
          const loc = locId ? locationById.get(locId) : null
          return (
            <div key={locId ?? 'unassigned'} style={{ marginBottom: 32 }}>
              {loc ? (
                <div style={{ marginBottom: 16 }}><ShelfBreadcrumb location={loc} /></div>
              ) : (
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--sh-text-muted)', marginBottom: 16, borderBottom: '1px solid var(--sh-border)', paddingBottom: 8 }}>Bez umístění</p>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 16 }}>
                {groupBooks.map((b) => (
                  <BookCard key={b.id} book={b} onDelete={setDeleteTargetId} />
                ))}
              </div>
            </div>
          )
        })}

        {total > PAGE_SIZE && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 24 }}>
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="sh-btn-secondary"
              style={{ opacity: page <= 1 ? 0.3 : 1, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}
            >
              ← Předchozí
            </button>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--sh-text-muted)' }}>
              {page} / {Math.ceil(total / PAGE_SIZE)}
            </span>
            <button
              disabled={page >= Math.ceil(total / PAGE_SIZE)}
              onClick={() => setPage((p) => p + 1)}
              className="sh-btn-secondary"
              style={{ opacity: page >= Math.ceil(total / PAGE_SIZE) ? 0.3 : 1, cursor: page >= Math.ceil(total / PAGE_SIZE) ? 'not-allowed' : 'pointer' }}
            >
              Další →
            </button>
          </div>
        )}
      </div>

      {deleteTargetId && (
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
            <h3 className="text-h3" style={{ marginTop: 0 }}>Smazat knihu?</h3>
            <p className="text-p" style={{ marginBottom: 24 }}>Tato akce je nevratná. Opravdu chceš knihu odstranit?</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteTargetId(null)}
                className="sh-btn-secondary"
              >
                Zrušit
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTargetId, { onSuccess: () => setDeleteTargetId(null) })}
                className="sh-btn-primary"
                style={{ background: 'var(--sh-red)' }}
              >
                {deleteMutation.isPending ? 'Mažu…' : 'Smazat knihu'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
