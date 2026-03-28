import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useLocations, useCreateLocation } from '../hooks/useLocations'
import { useConfirmShelfScan, useScanShelf, useShelfScanResult } from '../hooks/useScan'
import { useToastStore } from '../lib/toast-store'
import { ROUTES } from '../lib/routes'
import type { ConfirmBookItem, ScannedBookItem } from '../lib/types'

type WizardStep = 'location' | 'scan' | 'review'

export function ScanShelfPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const showError = useToastStore(s => s.showError)

  const { data: locations = [] } = useLocations()
  const createLocationMutation = useCreateLocation()
  const scanMutation = useScanShelf()
  const confirmMutation = useConfirmShelfScan()

  // Wizard state
  const [step, setStep] = useState<WizardStep>('location')

  // Location selection
  const [selRoom, setSelRoom] = useState('')
  const [selFurniture, setSelFurniture] = useState('')
  const [selShelf, setSelShelf] = useState('')
  const [newRoom, setNewRoom] = useState('')
  const [newFurniture, setNewFurniture] = useState('')
  const [newShelf, setNewShelf] = useState('')
  const [showNewLocation, setShowNewLocation] = useState(false)

  const rooms = [...new Set(locations.map(l => l.room))]
  const furnitures = [...new Set(locations.filter(l => l.room === selRoom).map(l => l.furniture))]
  const shelves = [...new Set(locations.filter(l => l.room === selRoom && l.furniture === selFurniture).map(l => l.shelf))]
  const resolvedId = locations.find(l => l.room === selRoom && l.furniture === selFurniture && l.shelf === selShelf)?.id ?? null

  // Scan state
  const [scanJobId, setScanJobId] = useState<string | null>(null)
  const scanResultQuery = useShelfScanResult(scanJobId)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Review state - editable copies of scanned books
  const [editableBooks, setEditableBooks] = useState<ConfirmBookItem[]>([])
  const [locationId, setLocationId] = useState<string | null>(null)

  // When scan completes, populate review state
  useEffect(() => {
    const data = scanResultQuery.data
    if (!data) return

    if (data.status === 'done' && data.books.length > 0) {
      setEditableBooks(data.books.map((b: ScannedBookItem) => ({
        position: b.position,
        title: b.title ?? b.observed_text ?? '',
        author: b.author ?? null,
        isbn: b.isbn ?? null,
      })))
      if (data.location_id) setLocationId(data.location_id)
      setStep('review')
    } else if (data.status === 'failed') {
      showError(data.error_message ?? t('scan.error_failed'))
      setScanJobId(null)
    }
  }, [scanResultQuery.data?.status])

  function handleLocationNext() {
    if (!resolvedId) {
      showError(t('scan.select_location'))
      return
    }
    setLocationId(resolvedId)
    setStep('scan')
  }

  function handleCreateLocation() {
    if (!newRoom.trim() || !newFurniture.trim() || !newShelf.trim()) {
      showError(t('scan.fill_location'))
      return
    }
    createLocationMutation.mutate(
      { room: newRoom.trim(), furniture: newFurniture.trim(), shelf: newShelf.trim() },
      {
        onSuccess: (loc) => {
          setSelRoom(loc.room)
          setSelFurniture(loc.furniture)
          setSelShelf(loc.shelf)
          setShowNewLocation(false)
          setNewRoom('')
          setNewFurniture('')
          setNewShelf('')
        },
      }
    )
  }

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    scanMutation.mutate(
      { file, locationId: locationId ?? undefined },
      { onSuccess: (res) => setScanJobId(res.job_id) }
    )
  }

  function updateBook(index: number, field: keyof ConfirmBookItem, value: string | null) {
    setEditableBooks(prev => prev.map((b, i) =>
      i === index ? { ...b, [field]: value } : b
    ))
  }

  function removeBook(index: number) {
    setEditableBooks(prev => prev.filter((_, i) => i !== index).map((b, i) => ({ ...b, position: i })))
  }

  function handleConfirm() {
    if (!locationId) {
      showError(t('scan.select_location'))
      return
    }
    const validBooks = editableBooks.filter(b => b.title.trim())
    if (validBooks.length === 0) {
      showError(t('scan.no_books'))
      return
    }
    confirmMutation.mutate(
      { location_id: locationId, books: validBooks },
      { onSuccess: () => navigate(ROUTES.bookshelfView + '?location_id=' + locationId) }
    )
  }

  const isScanning = scanMutation.isPending || (scanJobId !== null && scanResultQuery.data?.status !== 'done' && scanResultQuery.data?.status !== 'failed')

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
        <h2 className="text-h2" style={{ marginBottom: 0 }}>{t('scan.title')}</h2>
      </div>

      {/* Link to bookshelf view */}
      <button
        onClick={() => navigate(ROUTES.bookshelfView)}
        style={{
          width: '100%', marginBottom: 24, padding: '12px 16px',
          background: 'var(--sh-surface)', border: '1px solid var(--sh-border)',
          borderRadius: 'var(--sh-radius-md)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 12,
          color: 'var(--sh-text-main)', fontSize: 14, fontWeight: 500,
          transition: 'all 0.2s',
        }}
        className="hover-lift"
      >
        <span style={{ fontSize: 20 }}>📚</span>
        <span>{t('bookshelf.title')}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--sh-text-muted)' }}>→</span>
      </button>

      {/* Progress steps */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
        {(['location', 'scan', 'review'] as const).map((s, i) => (
          <div key={s} style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            background: step === s
              ? 'var(--sh-teal)'
              : (['location', 'scan', 'review'].indexOf(step) > i ? 'var(--sh-teal)' : 'var(--sh-border)'),
            transition: 'background 0.3s',
          }} />
        ))}
      </div>

      {/* STEP 1: Location */}
      {step === 'location' && (
        <div>
          <h3 className="text-h3" style={{ marginBottom: 8 }}>{t('scan.step_location')}</h3>
          <p className="text-small" style={{ color: 'var(--sh-text-muted)', marginBottom: 24 }}>{t('scan.step_location_desc')}</p>

          <div style={{ background: 'var(--sh-surface)', padding: 16, borderRadius: 'var(--sh-radius-md)', border: '1px solid var(--sh-border)', marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 6 }}>{t('locations.room')}</label>
                <select className="sh-select" style={{ padding: '10px 12px' }} value={selRoom} onChange={e => { setSelRoom(e.target.value); setSelFurniture(''); setSelShelf('') }}>
                  <option value="">—</option>
                  {rooms.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 6 }}>{t('locations.furniture')}</label>
                <select className="sh-select" style={{ padding: '10px 12px' }} value={selFurniture} disabled={!selRoom} onChange={e => { setSelFurniture(e.target.value); setSelShelf('') }}>
                  <option value="">—</option>
                  {furnitures.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 6 }}>{t('locations.shelf')}</label>
                <select className="sh-select" style={{ padding: '10px 12px' }} value={selShelf} disabled={!selFurniture} onChange={e => setSelShelf(e.target.value)}>
                  <option value="">—</option>
                  {shelves.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>

          <button
            onClick={() => setShowNewLocation(!showNewLocation)}
            style={{ fontSize: 13, color: 'var(--sh-teal)', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 0', fontWeight: 500 }}
          >
            {showNewLocation ? t('scan.hide_new_location') : t('scan.add_new_location')}
          </button>

          {showNewLocation && (
            <div style={{ background: 'var(--sh-teal-bg)', padding: 16, borderRadius: 'var(--sh-radius-md)', marginTop: 8, marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                <input className="sh-input" placeholder={t('locations.room_placeholder')} value={newRoom} onChange={e => setNewRoom(e.target.value)} />
                <input className="sh-input" placeholder={t('locations.furniture_placeholder')} value={newFurniture} onChange={e => setNewFurniture(e.target.value)} />
                <input className="sh-input" placeholder={t('locations.shelf_placeholder')} value={newShelf} onChange={e => setNewShelf(e.target.value)} />
              </div>
              <button
                className="sh-btn-primary"
                onClick={handleCreateLocation}
                disabled={createLocationMutation.isPending}
                style={{ padding: '8px 24px', fontSize: 14 }}
              >
                {createLocationMutation.isPending ? t('locations.creating') : t('locations.create')}
              </button>
            </div>
          )}

          <button
            className="sh-btn-primary hover-scale"
            onClick={handleLocationNext}
            disabled={!resolvedId}
            style={{
              width: '100%', marginTop: 24, padding: '16px', fontSize: 18,
              opacity: resolvedId ? 1 : 0.5, cursor: resolvedId ? 'pointer' : 'not-allowed',
            }}
          >
            {t('scan.next_step')}
          </button>
        </div>
      )}

      {/* STEP 2: Scan */}
      {step === 'scan' && (
        <div>
          <h3 className="text-h3" style={{ marginBottom: 8 }}>{t('scan.step_scan')}</h3>
          <p className="text-small" style={{ color: 'var(--sh-text-muted)', marginBottom: 24 }}>{t('scan.step_scan_desc')}</p>

          <div
            onClick={() => !isScanning && fileInputRef.current?.click()}
            style={{
              border: '2px dashed var(--sh-border-2)',
              borderRadius: 'var(--sh-radius-lg)',
              height: 200,
              background: isScanning ? 'var(--sh-amber-bg)' : 'var(--sh-surface)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              cursor: isScanning ? 'wait' : 'pointer',
              marginBottom: 24,
              color: 'var(--sh-text-muted)',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => { if (!isScanning) { e.currentTarget.style.borderColor = 'var(--sh-teal)'; e.currentTarget.style.background = 'var(--sh-teal-bg)' }}}
            onMouseLeave={(e) => { if (!isScanning) { e.currentTarget.style.borderColor = 'var(--sh-border-2)'; e.currentTarget.style.background = 'var(--sh-surface)' }}}
            className="hover-lift"
          >
            {isScanning ? (
              <>
                <span style={{ fontSize: 36 }}>⏳</span>
                <span className="text-p" style={{ fontWeight: 600, color: 'var(--sh-amber-text)' }}>{t('scan.scanning')}</span>
                <span className="text-small">{t('scan.scanning_desc')}</span>
              </>
            ) : (
              <>
                <span style={{ fontSize: 48, filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))' }}>📷</span>
                <span className="text-p" style={{ fontWeight: 600, color: 'var(--sh-text-main)' }}>{t('scan.take_photo')}</span>
                <span className="text-small">{t('scan.take_photo_desc')}</span>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
          </div>

          <button
            onClick={() => setStep('location')}
            style={{
              width: '100%', padding: '12px', fontSize: 14,
              background: 'none', border: '1px solid var(--sh-border)',
              borderRadius: 'var(--sh-radius-md)', cursor: 'pointer',
              color: 'var(--sh-text-muted)',
            }}
          >
            ← {t('scan.back_to_location')}
          </button>
        </div>
      )}

      {/* STEP 3: Review */}
      {step === 'review' && (
        <div>
          <h3 className="text-h3" style={{ marginBottom: 8 }}>{t('scan.step_review')}</h3>
          <p className="text-small" style={{ color: 'var(--sh-text-muted)', marginBottom: 24 }}>
            {t('scan.step_review_desc', { count: editableBooks.length })}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
            {editableBooks.map((book, idx) => (
              <div
                key={idx}
                style={{
                  background: 'var(--sh-surface)',
                  border: `1px solid ${book.title ? 'var(--sh-border)' : 'var(--sh-amber-text)'}`,
                  borderRadius: 'var(--sh-radius-md)',
                  padding: 16,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                    color: book.title ? 'var(--sh-teal)' : 'var(--sh-amber-text)',
                    background: book.title ? 'var(--sh-teal-bg)' : 'var(--sh-amber-bg)',
                    padding: '2px 8px', borderRadius: 'var(--sh-radius-sm)',
                  }}>
                    #{book.position + 1} {book.title ? '' : `· ${t('scan.needs_review')}`}
                  </span>
                  <button
                    onClick={() => removeBook(idx)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sh-red)', fontSize: 16, padding: 4 }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 4 }}>{t('scan.book_title')}</label>
                    <input
                      className="sh-input"
                      value={book.title}
                      onChange={e => updateBook(idx, 'title', e.target.value)}
                      placeholder={t('scan.book_title_placeholder')}
                      style={{ fontSize: 14 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--sh-text-muted)', display: 'block', marginBottom: 4 }}>{t('scan.book_author')}</label>
                    <input
                      className="sh-input"
                      value={book.author ?? ''}
                      onChange={e => updateBook(idx, 'author', e.target.value || null)}
                      placeholder={t('scan.book_author_placeholder')}
                      style={{ fontSize: 14 }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {editableBooks.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--sh-text-muted)' }}>
              <p>{t('scan.no_books_found')}</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => { setStep('scan'); setScanJobId(null) }}
              style={{
                flex: 1, padding: '14px', fontSize: 15,
                background: 'none', border: '1px solid var(--sh-border)',
                borderRadius: 'var(--sh-radius-md)', cursor: 'pointer',
                color: 'var(--sh-text-muted)',
              }}
            >
              {t('scan.rescan')}
            </button>
            <button
              className="sh-btn-primary hover-scale"
              onClick={handleConfirm}
              disabled={confirmMutation.isPending || editableBooks.filter(b => b.title.trim()).length === 0}
              style={{
                flex: 2, padding: '14px', fontSize: 15,
                opacity: confirmMutation.isPending ? 0.7 : 1,
              }}
            >
              {confirmMutation.isPending
                ? t('scan.saving')
                : t('scan.confirm_books', { count: editableBooks.filter(b => b.title.trim()).length })
              }
            </button>
          </div>

          <div style={{ height: 32 }} />
        </div>
      )}
    </div>
  )
}
