import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateBook, useUploadBookImage, useJobStatus } from '../hooks/useBooks'
import { useLocations } from '../hooks/useLocations'
import { useToastStore } from '../lib/toast-store'
import { ROUTES } from '../lib/routes'
import type { BookCreateRequest, ReadingStatus } from '../lib/types'

const inputStyle = {
  width: '100%',
  padding: '9px 12px',
  border: '0.5px solid rgba(0,0,0,0.18)',
  borderRadius: 10,
  fontSize: 14,
  background: 'white',
  outline: 'none',
} as const

export function AddBookPage() {
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
  const [lentTo, setLentTo]           = useState('')

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
      lent_to:        reading === 'lent' ? (lentTo.trim() || null) : null,
    }
    createMutation.mutate(payload, {
      onSuccess: () => navigate(ROUTES.books),
      onError:   ()  => showError('Nepodařilo se přidat knihu.'),
    })
  }

  return (
    <div style={{ padding: '16px 16px 0' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          onClick={() => navigate(ROUTES.books)}
          style={{ width: 36, height: 36, borderRadius: 10, border: '0.5px solid rgba(0,0,0,0.15)', background: '#F7F7F5', cursor: 'pointer', fontSize: 16 }}
        >
          ←
        </button>
        <h2 style={{ fontSize: 18, fontWeight: 500 }}>Přidat knihu</h2>
      </div>

      {/* Scan area */}
      <div
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: '1.5px dashed rgba(0,0,0,0.18)',
          borderRadius: 14,
          height: 150,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          cursor: 'pointer',
          marginBottom: 18,
          color: '#888',
        }}
      >
        <span style={{ fontSize: 32 }}>📸</span>
        <span style={{ fontSize: 14, fontWeight: 500 }}>
          {uploadMutation.isPending ? 'Nahrávám…' : 'Naskenovat hřbet'}
        </span>
        <span style={{ fontSize: 11, color: '#aaa' }}>AI rozpozná název a autora</span>
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" style={{ display: 'none' }} onChange={handleFileChange} />
      </div>
      {uploadJobId && (
        <p style={{ fontSize: 12, color: '#BA7517', marginBottom: 10, textAlign: 'center' }}>
          ⏳ Zpracovávám obrázek…
        </p>
      )}

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
        <hr style={{ flex: 1, border: 'none', borderTop: '0.5px solid rgba(0,0,0,0.12)' }} />
        <span style={{ fontSize: 12, color: '#aaa' }}>nebo zadat ručně</span>
        <hr style={{ flex: 1, border: 'none', borderTop: '0.5px solid rgba(0,0,0,0.12)' }} />
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5 }}>Název *</label>
          <input style={inputStyle} placeholder="např. Duna" value={title} onChange={e => setTitle(e.target.value)} required />
        </div>

        <div>
          <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5 }}>Autor</label>
          <input style={inputStyle} placeholder="např. Frank Herbert" value={author} onChange={e => setAuthor(e.target.value)} />
        </div>

        {/* 3-level location */}
        <div>
          <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5 }}>Umístění</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: 11, color: '#aaa', display: 'block', marginBottom: 3 }}>Místnost</label>
              <select
                style={inputStyle}
                value={selRoom}
                onChange={e => { setSelRoom(e.target.value); setSelFurniture(''); setSelShelf('') }}
              >
                <option value="">—</option>
                {rooms.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#aaa', display: 'block', marginBottom: 3 }}>Knihovna</label>
              <select
                style={inputStyle}
                value={selFurniture}
                disabled={!selRoom}
                onChange={e => { setSelFurniture(e.target.value); setSelShelf('') }}
              >
                <option value="">—</option>
                {furnitures.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#aaa', display: 'block', marginBottom: 3 }}>Police</label>
              <select
                style={inputStyle}
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

        {/* Reading status */}
        <div>
          <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5 }}>Stav</label>
          <select
            style={inputStyle}
            value={reading}
            onChange={e => setReading(e.target.value as ReadingStatus)}
          >
            <option value="unread">Nepřečteno</option>
            <option value="reading">Čtu</option>
            <option value="read">Přečteno</option>
            <option value="lent">Půjčeno</option>
          </select>
        </div>

        {reading === 'lent' && (
          <div>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5 }}>Půjčeno komu</label>
            <input style={inputStyle} placeholder="Jméno nebo přezdívka" value={lentTo} onChange={e => setLentTo(e.target.value)} />
          </div>
        )}

        <div>
          <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5 }}>ISBN (volitelné)</label>
          <input style={inputStyle} placeholder="978-80-…" value={isbn} onChange={e => setIsbn(e.target.value)} />
        </div>

        <button
          type="submit"
          disabled={createMutation.isPending}
          style={{
            width: '100%',
            padding: 13,
            background: createMutation.isPending ? '#9FE1CB' : '#1D9E75',
            color: 'white',
            border: 'none',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 500,
            cursor: createMutation.isPending ? 'not-allowed' : 'pointer',
            marginTop: 4,
            marginBottom: 24,
          }}
        >
          {createMutation.isPending ? 'Přidávám…' : 'Přidat do knihovny'}
        </button>
      </form>
    </div>
  )
}
