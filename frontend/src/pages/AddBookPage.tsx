import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ProcessingIcon } from '../components/EmptyStateIcons'
import { useCreateBook, useUploadBookImage, useJobStatus } from '../hooks/useBooks'
import { useLocations } from '../hooks/useLocations'
import { useToastStore } from '../lib/toast-store'
import { ROUTES } from '../lib/routes'
import type { BookCreateRequest, ReadingStatus } from '../lib/types'

export function AddBookPage() {
  const { t } = useTranslation()
  const navigate      = useNavigate()
  const showError     = useToastStore(s => s.showError)
  const { data: locations = [] } = useLocations()
  const createMutation  = useCreateBook()
  const uploadMutation  = useUploadBookImage()
  const fileInputRef    = useRef<HTMLInputElement>(null)

  const [uploadJobId, setUploadJobId] = useState<string | null>(null)
  const [title, setTitle]             = useState('')
  const [author, setAuthor]           = useState('')
  const [isbn, setIsbn]               = useState('')
  const [reading, setReading]         = useState<ReadingStatus>('unread')

  // Three-level location picker
  const [selRoom, setSelRoom]       = useState('')
  const [selFurniture, setSelFurniture] = useState('')
  const [selShelf, setSelShelf]     = useState('')

  const rooms      = [...new Set(locations.map(l => l.room))]
  const furnitures = [...new Set(locations.filter(l => l.room === selRoom).map(l => l.furniture))]
  const shelves    = [...new Set(locations.filter(l => l.room === selRoom && l.furniture === selFurniture).map(l => l.shelf))]
  const resolvedId = locations.find(l => l.room === selRoom && l.furniture === selFurniture && l.shelf === selShelf)?.id ?? null

  // Poll upload job
  const uploadJobStatusQuery = useJobStatus(uploadJobId)

  useEffect(() => {
    const status = uploadJobStatusQuery.data?.status
    if (status === 'done' || status === 'failed') {
      if (status === 'failed') {
        showError(uploadJobStatusQuery.data?.error_message ?? 'Zpracování obrázku selhalo.')
      }
      setUploadJobId(null)
    }
  }, [uploadJobStatusQuery.data?.status, uploadJobStatusQuery.data?.error_message, showError])

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    uploadMutation.mutate(file, {
      onSuccess: res => setUploadJobId(res.job_id),
    })
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) { showError('Název knihy je povinný.'); return }
    const payload: BookCreateRequest = {
      title: title.trim(),
      author:         author.trim() || null,
      isbn:           isbn.trim()   || null,
      location_id:    resolvedId,
      reading_status: reading,
    }
    createMutation.mutate(payload, {
      onSuccess: () => navigate(ROUTES.books),
      onError:   ()  => showError('Nepodařilo se přidat knihu.'),
    })
  }

  return (
    <div className="container md-max-w-3xl" style={{ margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <button
          onClick={() => navigate(ROUTES.books)}
          style={{ width: 40, height: 40, borderRadius: 'var(--sh-radius-md)', border: '1px solid var(--sh-border)', background: 'var(--sh-surface)', cursor: 'pointer', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          className="hover-lift"
        >
          ←
        </button>
        <h2 className="text-h2" style={{ marginBottom: 0 }}>Přidat knihu</h2>
      </div>

      {/* Scan area */}
      <div
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: '2px dashed var(--sh-border-2)',
          borderRadius: 'var(--sh-radius-lg)',
          height: 160,
          background: 'var(--sh-surface)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          cursor: 'pointer',
          marginBottom: 24,
          color: 'var(--sh-text-muted)',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--sh-teal)';
          e.currentTarget.style.background = 'var(--sh-teal-bg)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--sh-border-2)';
          e.currentTarget.style.background = 'var(--sh-surface)';
        }}
        className="hover-lift"
      >
        <span style={{ fontSize: 36, filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))' }}>📸</span>
        <span className="text-p" style={{ fontWeight: 600, color: 'var(--sh-text-main)' }}>
          {uploadMutation.isPending ? 'Nahrávám…' : 'Naskenovat hřbet'}
        </span>
        <span className="text-small">AI rozpozná název a autora</span>
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" style={{ display: 'none' }} onChange={handleFileChange} />
      </div>
      {uploadJobId && (
        <p style={{ fontSize: 13, color: 'var(--sh-amber-text)', background: 'var(--sh-amber-bg)', padding: '12px', borderRadius: 'var(--sh-radius-md)', marginBottom: 20, textAlign: 'center', fontWeight: 500 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><ProcessingIcon size={18} className="sh-icon-processing" />{t('add_book.processing_label', 'Zpracovávám obrázek…')}</span>
        </p>
      )}

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0' }}>
        <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--sh-border)' }} />
        <span style={{ fontSize: 13, color: 'var(--sh-text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>nebo zadat ručně</span>
        <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--sh-border)' }} />
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="md-grid-2">
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--sh-text-main)', display: 'block', marginBottom: 8 }}>Název <span style={{ color: 'var(--sh-red)' }}>*</span></label>
            <input className="sh-input" placeholder="např. Duna" value={title} onChange={e => setTitle(e.target.value)} required />
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--sh-text-main)', display: 'block', marginBottom: 8 }}>Autor</label>
            <input className="sh-input" placeholder="např. Frank Herbert" value={author} onChange={e => setAuthor(e.target.value)} />
          </div>
        </div>

        {/* 3-level location */}
        <div style={{ background: 'var(--sh-surface)', padding: 16, borderRadius: 'var(--sh-radius-md)', border: '1px solid var(--sh-border)' }}>
          <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--sh-text-main)', display: 'block', marginBottom: 12 }}>Umístění</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 6 }}>Místnost</label>
              <select
                className="sh-select"
                style={{ padding: '10px 12px' }}
                value={selRoom}
                onChange={e => { setSelRoom(e.target.value); setSelFurniture(''); setSelShelf('') }}
              >
                <option value="">—</option>
                {rooms.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 6 }}>Knihovna</label>
              <select
                className="sh-select"
                style={{ padding: '10px 12px' }}
                value={selFurniture}
                disabled={!selRoom}
                onChange={e => { setSelFurniture(e.target.value); setSelShelf('') }}
              >
                <option value="">—</option>
                {furnitures.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 6 }}>Police</label>
              <select
                className="sh-select"
                style={{ padding: '10px 12px' }}
                value={selShelf}
                disabled={!selFurniture}
                onChange={e => setSelShelf(e.target.value)}
              >
                <option value="">—</option>
                {shelves.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="md-grid-2">
          {/* Reading status */}
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--sh-text-main)', display: 'block', marginBottom: 8 }}>Stav</label>
              <select
                className="sh-select"
                value={reading}
                onChange={e => setReading(e.target.value as ReadingStatus)}
              >
                <option value="unread">Nepřečteno</option>
                <option value="reading">Čtu</option>
                <option value="read">Přečteno</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--sh-text-main)', display: 'block', marginBottom: 8 }}>ISBN <span style={{ color: 'var(--sh-text-muted)', fontWeight: 400 }}>(volitelné)</span></label>
            <input className="sh-input" placeholder="978-80-…" value={isbn} onChange={e => setIsbn(e.target.value)} />
          </div>
        </div>

        <button
          type="submit"
          className="sh-btn-primary hover-scale"
          disabled={createMutation.isPending}
          style={{
            width: '100%',
            opacity: createMutation.isPending ? 0.7 : 1,
            cursor: createMutation.isPending ? 'not-allowed' : 'pointer',
            marginTop: 12,
            marginBottom: 32,
            padding: '16px',
            fontSize: 18,
          }}
        >
          {createMutation.isPending ? 'Přidávám…' : 'Přidat do knihovny'}
        </button>
      </form>
    </div>
  )
}
