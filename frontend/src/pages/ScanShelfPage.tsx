import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { BookshelfInlineIcon, CameraIcon, ProcessingIcon } from '../components/EmptyStateIcons'
import { useLocations, useCreateLocation } from '../hooks/useLocations'
import { useBooksByLocation, useConfirmShelfScan, useScanShelf, useShelfScanResult } from '../hooks/useScan'
import { useToastStore } from '../lib/toast-store'
import { ROUTES } from '../lib/routes'
import { trackEvent } from '../lib/analytics'
import type { Book, ConfirmBookItem, ScannedBookItem } from '../lib/types'

type WizardStep = 'location' | 'scan' | 'review'
type ScanMode = 'replace' | 'append-right'

interface ReviewBookItem extends ConfirmBookItem {
  localId: string
  observedText: string | null
  confidence: ScannedBookItem['confidence'] | null
}

interface ScanSegment {
  jobId: string
  photoIndex: number
  status: 'processing' | 'done' | 'failed'
  books: ScannedBookItem[]
}

interface ScanDraft {
  version: 1
  step: WizardStep
  selRoom: string
  selFurniture: string
  selShelf: string
  newRoom: string
  newFurniture: string
  newShelf: string
  showNewLocation: boolean
  segments: ScanSegment[]
  editableBooks: ReviewBookItem[]
  locationId: string | null
  scanMode: ScanMode
  appendAfterBookId: string | null
  savedAt: string
}

const SCAN_DRAFT_KEY = 'shelfy:scan-shelf-draft:v1'

export function ScanShelfPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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

  // Multi-photo scan state
  const [segments, setSegments] = useState<ScanSegment[]>([])
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const activeResult = useShelfScanResult(activeJobId)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Review state
  const [editableBooks, setEditableBooks] = useState<ReviewBookItem[]>([])
  const [locationId, setLocationId] = useState<string | null>(null)
  const [scanMode, setScanMode] = useState<ScanMode>('replace')
  const [appendAfterBookId, setAppendAfterBookId] = useState<string | null>(null)
  const [pendingDraft, setPendingDraft] = useState<ScanDraft | null>(null)

  const { data: booksAtLocation = [] } = useBooksByLocation(locationId)
  const existingShelfBooks = [...booksAtLocation].sort((a, b) => (a.shelf_position ?? 99999) - (b.shelf_position ?? 99999))

  // When an active scan job completes, update the segment
  useEffect(() => {
    const data = activeResult.data
    if (!data || !activeJobId) return

    if (data.status === 'done') {
      setSegments(prev => prev.map(seg =>
        seg.jobId === activeJobId
          ? { ...seg, status: 'done', books: data.books }
          : seg
      ))
      setActiveJobId(null)
    } else if (data.status === 'failed') {
      showError(data.error_message ?? t('scan.error_failed'))
      setSegments(prev => prev.map(seg =>
        seg.jobId === activeJobId
          ? { ...seg, status: 'failed' }
          : seg
      ))
      setActiveJobId(null)
    }
  }, [activeResult.data?.status])


  useEffect(() => {
    try {
      const raw = localStorage.getItem(SCAN_DRAFT_KEY)
      if (!raw) return
      const draft = JSON.parse(raw) as ScanDraft
      if (draft?.version !== 1) {
        localStorage.removeItem(SCAN_DRAFT_KEY)
        return
      }
      setPendingDraft(draft)
    } catch {
      localStorage.removeItem(SCAN_DRAFT_KEY)
    }
  }, [])

  useEffect(() => {
    const hasDraftData =
      step !== 'location'
      || !!selRoom
      || !!selFurniture
      || !!selShelf
      || !!newRoom
      || !!newFurniture
      || !!newShelf
      || showNewLocation
      || segments.length > 0
      || editableBooks.length > 0
      || !!locationId
      || scanMode !== 'replace'
      || !!appendAfterBookId

    if (!hasDraftData) {
      localStorage.removeItem(SCAN_DRAFT_KEY)
      return
    }

    const timer = setTimeout(() => {
      const draft: ScanDraft = {
        version: 1,
        step,
        selRoom,
        selFurniture,
        selShelf,
        newRoom,
        newFurniture,
        newShelf,
        showNewLocation,
        segments: segments.filter(seg => seg.status !== 'processing'),
        editableBooks,
        locationId,
        scanMode,
        appendAfterBookId,
        savedAt: new Date().toISOString(),
      }
      localStorage.setItem(SCAN_DRAFT_KEY, JSON.stringify(draft))
    }, 400)

    return () => clearTimeout(timer)
  }, [step, selRoom, selFurniture, selShelf, newRoom, newFurniture, newShelf, showNewLocation, segments, editableBooks, locationId, scanMode, appendAfterBookId])

  useEffect(() => {
    const preLocationId = searchParams.get('location_id')
    const preAppendAfterBookId = searchParams.get('append_after_book_id')
    if (!preLocationId || locations.length === 0) return
    const loc = locations.find((l) => l.id === preLocationId)
    if (!loc) return
    setSelRoom(loc.room)
    setSelFurniture(loc.furniture)
    setSelShelf(loc.shelf)
    setLocationId(loc.id)
    if (preAppendAfterBookId) {
      setScanMode('append-right')
      setAppendAfterBookId(preAppendAfterBookId)
      setStep('scan')
    }
  }, [searchParams, locations])

  // Derived state
  const totalBooksFound = segments.reduce((sum, seg) => sum + seg.books.length, 0)
  const isProcessing = scanMutation.isPending || activeJobId !== null
  const hasCompletedSegments = segments.some(seg => seg.status === 'done' && seg.books.length > 0)

  function handleLocationNext() {
    if (!resolvedId) {
      showError(t('scan.select_location'))
      return
    }
    setLocationId(resolvedId)
    setScanMode('replace')
    setAppendAfterBookId(null)
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
    // Reset input so the same file can be selected again
    e.target.value = ''

    const photoIndex = segments.length
    scanMutation.mutate(
      { file, locationId: locationId ?? undefined },
      {
        onSuccess: (res) => {
          setSegments(prev => [...prev, {
            jobId: res.job_id,
            photoIndex,
            status: 'processing',
            books: [],
          }])
          setActiveJobId(res.job_id)
        },
      }
    )
  }

  const handleGoToReview = useCallback(() => {
    // Merge all books from all segments, maintaining left-to-right order across photos
    const allBooks: ReviewBookItem[] = []
    let globalPosition = 0
    for (const seg of segments) {
      if (seg.status !== 'done') continue
      for (const b of seg.books) {
        const observed = (b.observed_text ?? '').toLowerCase()
        const noVisibleText = observed.includes('no visible text') || observed.includes('no readable text')
        const lowConfidence = b.confidence === 'needs_review' || b.confidence === 'low'

        const normalizedTitle = (!noVisibleText && !lowConfidence)
          ? (b.title ?? b.observed_text ?? '')
          : ''

        const normalizedAuthor = (!noVisibleText && !lowConfidence)
          ? (b.author ?? null)
          : null

        const position = globalPosition++
        allBooks.push({
          localId: `${seg.jobId}:${position}:${b.observed_text ?? ''}`,
          position,
          title: normalizedTitle,
          author: normalizedAuthor,
          isbn: b.isbn ?? null,
          observedText: b.observed_text ?? null,
          confidence: b.confidence ?? null,
        })
      }
    }
    setEditableBooks(allBooks)
    setStep('review')
  }, [segments])

  function removeSegment(index: number) {
    setSegments(prev => prev.filter((_, i) => i !== index))
  }

  function updateBook(localId: string, field: keyof ConfirmBookItem, value: string | null) {
    setEditableBooks(prev => prev.map((b) =>
      b.localId === localId ? { ...b, [field]: value } : b
    ))
  }

  function removeBook(localId: string) {
    setEditableBooks(prev => prev
      .filter((b) => b.localId !== localId)
      .map((b, i) => ({ ...b, position: i })))
  }


  function clearDraft() {
    localStorage.removeItem(SCAN_DRAFT_KEY)
    setPendingDraft(null)
  }

  function restoreDraft() {
    if (!pendingDraft) return
    setStep(pendingDraft.step)
    setSelRoom(pendingDraft.selRoom)
    setSelFurniture(pendingDraft.selFurniture)
    setSelShelf(pendingDraft.selShelf)
    setNewRoom(pendingDraft.newRoom)
    setNewFurniture(pendingDraft.newFurniture)
    setNewShelf(pendingDraft.newShelf)
    setShowNewLocation(pendingDraft.showNewLocation)
    setSegments(pendingDraft.segments)
    setEditableBooks(pendingDraft.editableBooks)
    setLocationId(pendingDraft.locationId)
    setScanMode(pendingDraft.scanMode ?? 'replace')
    setAppendAfterBookId(pendingDraft.appendAfterBookId ?? null)
    setActiveJobId(null)
    setPendingDraft(null)
  }

  function handleConfirm() {
    if (!locationId) {
      showError(t('scan.select_location'))
      return
    }
    const validBooks = editableBooks
      .filter(b => b.title.trim())
      .map(({ position, title, author, isbn }) => ({ position, title, author, isbn }))
    if (validBooks.length === 0) {
      showError(t('scan.no_books'))
      return
    }
    confirmMutation.mutate(
      {
        location_id: locationId,
        append_after_book_id: scanMode === 'append-right' ? appendAfterBookId : null,
        books: validBooks,
      },
      {
        onSuccess: () => {
          trackEvent('shelf_scanned', { book_count: validBooks.length })
          clearDraft()
          navigate(ROUTES.bookshelfView + '?location_id=' + locationId)
        },
      }
    )
  }

  return (
    <div className="container md-max-w-3xl" style={{ margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div className="sh-page-header">
        <button
          onClick={() => navigate(ROUTES.books)}
          className="sh-back-btn hover-lift"
        >
          ←
        </button>
        <h2 className="text-h2" style={{ marginBottom: 0 }}>{t('scan.title')}</h2>
      </div>

      {/* Link to bookshelf view */}
      <button
        onClick={() => navigate(ROUTES.bookshelfView)}
        className="sh-card-panel hover-lift"
        style={{
          width: '100%', marginBottom: 24, padding: '12px 16px',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
          color: 'var(--sh-text-main)', fontSize: 14, fontWeight: 500,
          transition: 'all 0.2s',
        }}
      >
        <BookshelfInlineIcon size={20} style={{ color: 'var(--sh-primary)' }} />
        <span>{t('bookshelf.title')}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--sh-text-muted)' }}>→</span>
      </button>

      {/* Labeled stepper */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 32 }}>
        {(['location', 'scan', 'review'] as const).map((s, i) => {
          const stepIndex = ['location', 'scan', 'review'].indexOf(step)
          const isDone = stepIndex > i
          const isActive = step === s
          const labels = [t('scan.stepper_location'), t('scan.stepper_scan'), t('scan.stepper_review')]

          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 56 }}>
                <div className={`sh-stepper-circle ${isDone || isActive ? 'sh-stepper-circle--active' : 'sh-stepper-circle--future'}`}>
                  {isDone ? '✓' : i + 1}
                </div>
                <span style={{
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 500,
                  color: isDone || isActive ? 'var(--sh-teal-text)' : 'var(--sh-text-muted)',
                  transition: 'color 0.3s',
                  whiteSpace: 'nowrap',
                }}>
                  {labels[i]}
                </span>
              </div>
              {i < 2 && (
                <div style={{
                  flex: 1,
                  height: 2,
                  background: stepIndex > i ? 'var(--sh-teal)' : 'var(--sh-border)',
                  marginBottom: 18,
                  transition: 'background 0.3s',
                }} />
              )}
            </div>
          )
        })}
      </div>

      {pendingDraft && (
        <div style={{
          marginBottom: 20,
          padding: 14,
          background: 'var(--sh-amber-bg)',
          border: '1px solid var(--sh-amber-text)',
          borderRadius: 'var(--sh-radius-md)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{t('scan.draft_found_title')}</div>
          <div style={{ fontSize: 13, color: 'var(--sh-text-muted)', marginBottom: 10 }}>{t('scan.draft_found_desc')}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="sh-btn-primary" onClick={restoreDraft} style={{ padding: '8px 12px', fontSize: 14 }}>
              {t('scan.restore_draft')}
            </button>
            <button
              onClick={clearDraft}
              style={{
                padding: '8px 12px', fontSize: 14,
                background: 'none', border: '1px solid var(--sh-border)',
                borderRadius: 'var(--sh-radius-md)', cursor: 'pointer',
              }}
            >
              {t('scan.discard_draft')}
            </button>
          </div>
        </div>
      )}

      {/* STEP 1: Location */}
      {step === 'location' && (
        <div>
          <h3 className="text-h3" style={{ marginBottom: 8 }}>{t('scan.step_location')}</h3>
          <p className="text-small" style={{ color: 'var(--sh-text-muted)', marginBottom: 24 }}>{t('scan.step_location_desc')}</p>

          <div className="sh-card-panel" style={{ padding: 16, marginBottom: 16 }}>
            <div className="sh-location-grid">
              <div>
                <label className="sh-form-label--sm">{t('locations.room')}</label>
                <select className="sh-select" style={{ padding: '10px 12px', background: 'var(--sh-input-bg)', color: 'var(--sh-text-main)' }} value={selRoom} onChange={e => { setSelRoom(e.target.value); setSelFurniture(''); setSelShelf('') }}>
                  <option value="">—</option>
                  {rooms.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="sh-form-label--sm">{t('locations.furniture')}</label>
                <select className="sh-select" style={{ padding: '10px 12px', background: 'var(--sh-input-bg)', color: 'var(--sh-text-main)' }} value={selFurniture} disabled={!selRoom} onChange={e => { setSelFurniture(e.target.value); setSelShelf('') }}>
                  <option value="">—</option>
                  {furnitures.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="sh-form-label--sm">{t('locations.shelf')}</label>
                <select className="sh-select" style={{ padding: '10px 12px', background: 'var(--sh-input-bg)', color: 'var(--sh-text-main)' }} value={selShelf} disabled={!selFurniture} onChange={e => setSelShelf(e.target.value)}>
                  <option value="">—</option>
                  {shelves.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              const next = !showNewLocation
              setShowNewLocation(next)
              if (next) {
                setNewRoom(selRoom)
                setNewFurniture(selFurniture)
              }
            }}
            style={{ fontSize: 13, color: 'var(--sh-teal)', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 0', fontWeight: 500 }}
          >
            {showNewLocation ? t('scan.hide_new_location') : t('scan.add_new_location')}
          </button>

          {showNewLocation && (
            <div style={{ background: 'var(--sh-teal-bg)', padding: 16, borderRadius: 'var(--sh-radius-md)', marginTop: 8, marginBottom: 16 }}>
              <div className="sh-location-grid" style={{ marginBottom: 12 }}>
                <>
                  <input
                    className="sh-input"
                    placeholder={t('locations.room_placeholder')}
                    value={newRoom}
                    list="scan-room-suggestions"
                    onChange={e => setNewRoom(e.target.value)}
                  />
                  <datalist id="scan-room-suggestions">
                    {rooms.map(r => <option key={r} value={r} />)}
                  </datalist>
                </>
                <>
                  <input
                    className="sh-input"
                    placeholder={t('locations.furniture_placeholder')}
                    value={newFurniture}
                    list="scan-furniture-suggestions"
                    onChange={e => setNewFurniture(e.target.value)}
                  />
                  <datalist id="scan-furniture-suggestions">
                    {[...new Set(locations.filter(l => !newRoom || l.room === newRoom).map(l => l.furniture))].map(f => <option key={f} value={f} />)}
                  </datalist>
                </>
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

      {/* STEP 2: Multi-photo scan */}
      {step === 'scan' && (
        <div>
          <h3 className="text-h3" style={{ marginBottom: 8 }}>{t('scan.step_scan')}</h3>
          <p className="text-small" style={{ color: 'var(--sh-text-muted)', marginBottom: 24 }}>{t('scan.step_scan_multi_desc')}</p>

          <div className="sh-card-panel" style={{ padding: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <button
                type="button"
                className={`sh-btn-secondary sh-tab-toggle${scanMode === 'replace' ? ' sh-tab-toggle--active' : ''}`}
                onClick={() => { setScanMode('replace'); setAppendAfterBookId(null) }}
              >
                {t('scan.mode_replace')}
              </button>
              <button
                type="button"
                className={`sh-btn-secondary sh-tab-toggle${scanMode === 'append-right' ? ' sh-tab-toggle--active' : ''}`}
                onClick={() => setScanMode('append-right')}
              >
                {t('scan.mode_append_right')}
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--sh-text-muted)', marginBottom: 10 }}>
              {scanMode === 'replace' ? t('scan.mode_replace_desc') : t('scan.mode_append_desc')}
            </div>

            {scanMode === 'append-right' && (
              <div>
                <label className="sh-form-label--sm">
                  {t('scan.start_from_book')}
                </label>
                <select
                  className="sh-select"
                  style={{ padding: '10px 12px', background: 'var(--sh-input-bg)', color: 'var(--sh-text-main)' }}
                  value={appendAfterBookId ?? ''}
                  onChange={(e) => setAppendAfterBookId(e.target.value || null)}
                >
                  <option value="">{t('scan.select_start_book')}</option>
                  {existingShelfBooks.map((book: Book) => (
                    <option key={book.id} value={book.id}>
                      #{(book.shelf_position ?? 0) + 1} — {book.title}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 12, color: 'var(--sh-text-muted)', marginTop: 6 }}>
                  {t('scan.append_hint')}
                </div>
              </div>
            )}
          </div>

          {/* Upload area */}
          <div
            onClick={() => !isProcessing && fileInputRef.current?.click()}
            className={`sh-upload-area hover-lift${isProcessing ? ' sh-upload-area--processing' : ''}`}
            style={{ marginBottom: 16 }}
          >
            {isProcessing ? (
              <>
                <ProcessingIcon size={48} className="sh-icon-processing" />
                <span className="text-p" style={{ fontWeight: 600, color: 'var(--sh-amber-text)' }}>{t('scan.scanning')}</span>
                <span className="text-small">{t('scan.scanning_desc')}</span>
              </>
            ) : (
              <>
                <CameraIcon size={48} style={{ color: 'var(--sh-primary)', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.08))' }} />
                <span className="text-p" style={{ fontWeight: 600, color: 'var(--sh-text-main)' }}>
                  {segments.length === 0 ? t('scan.take_photo') : t('scan.take_next_photo')}
                </span>
                <span className="text-small">
                  {segments.length === 0 ? t('scan.take_photo_desc') : t('scan.take_next_photo_desc')}
                </span>
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

          {/* Segments list */}
          {segments.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sh-text-main)', marginBottom: 8 }}>
                {t('scan.photos_taken', { count: segments.length })}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {segments.map((seg, idx) => (
                  <div
                    key={seg.jobId}
                    className="sh-segment-item"
                  >
                    <span style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: seg.status === 'done' ? 'var(--sh-teal)' : seg.status === 'failed' ? 'var(--sh-red)' : 'var(--sh-amber-text)',
                      color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 600, flexShrink: 0,
                    }}>
                      {seg.status === 'done' ? '✓' : seg.status === 'failed' ? '!' : '…'}
                    </span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 14, fontWeight: 500 }}>
                        {t('scan.photo_segment', { index: idx + 1 })}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--sh-text-muted)', marginLeft: 8 }}>
                        {seg.status === 'done'
                          ? t('scan.segment_books_found', { count: seg.books.length })
                          : seg.status === 'failed'
                            ? t('scan.segment_failed')
                            : t('scan.segment_processing')
                        }
                      </span>
                    </div>
                    {seg.status !== 'processing' && (
                      <button
                        onClick={() => removeSegment(idx)}
                        aria-label={t('scan.remove_item')}
                        className="sh-touch-target"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sh-text-muted)', fontSize: 16 }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {totalBooksFound > 0 && (
                <div style={{
                  marginTop: 12, padding: '8px 14px',
                  background: 'var(--sh-teal-bg)', borderRadius: 'var(--sh-radius-md)',
                  fontSize: 13, fontWeight: 500, color: 'var(--sh-teal)',
                }}>
                  {t('scan.total_books_found', { count: totalBooksFound })}
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => { setStep('location'); setSegments([]) }}
              style={{
                flex: 1, padding: '12px', fontSize: 14,
                background: 'none', border: '1px solid var(--sh-border)',
                borderRadius: 'var(--sh-radius-md)', cursor: 'pointer',
                color: 'var(--sh-text-muted)',
              }}
            >
              ← {t('scan.back_to_location')}
            </button>
            {hasCompletedSegments && (
              <button
                className="sh-btn-primary hover-scale"
                onClick={handleGoToReview}
                disabled={isProcessing || (scanMode === 'append-right' && !appendAfterBookId)}
                style={{
                  flex: 2, padding: '12px', fontSize: 15,
                  opacity: isProcessing ? 0.6 : 1,
                }}
              >
                {t('scan.go_to_review', { count: totalBooksFound })}
              </button>
            )}
          </div>
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
            {editableBooks.map((book) => {
              const isLowConfidence = book.confidence === 'needs_review' || book.confidence === 'low' || !book.title

              return (
                <div
                  key={book.localId}
                  className={`sh-review-card${isLowConfidence ? ' sh-review-card--warn' : ''}`}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                        color: isLowConfidence ? 'var(--sh-amber-text)' : 'var(--sh-teal)',
                        background: isLowConfidence ? 'var(--sh-amber-bg)' : 'var(--sh-teal-bg)',
                        padding: '2px 8px', borderRadius: 'var(--sh-radius-sm)',
                      }}>
                        #{book.position + 1}
                      </span>
                      {isLowConfidence && (
                        <span style={{ fontSize: 11, color: 'var(--sh-amber-text)', fontWeight: 500 }}>
                          {t('scan.needs_review')}
                        </span>
                      )}
                      {book.observedText && book.observedText !== book.title && (
                        <span style={{ fontSize: 10, color: 'var(--sh-text-muted)', fontStyle: 'italic' }}>
                          {t('scan.observed')}: &ldquo;{book.observedText.slice(0, 40)}{book.observedText.length > 40 ? '…' : ''}&rdquo;
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={t('scan.remove_item')}
                      title={t('scan.remove_item')}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        removeBook(book.localId)
                      }}
                      className="sh-touch-target"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sh-red)', fontSize: 16 }}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="sh-review-fields">
                    <div>
                      <label className="sh-form-label--sm" style={{ fontSize: 11, marginBottom: 4 }}>{t('scan.book_title')}</label>
                      <input
                        className="sh-input"
                        value={book.title}
                        onChange={e => updateBook(book.localId, 'title', e.target.value)}
                        placeholder={t('scan.book_title_placeholder')}
                        style={{
                          fontSize: 14,
                          borderColor: isLowConfidence ? 'var(--sh-amber-text)' : undefined,
                        }}
                      />
                    </div>
                    <div>
                      <label className="sh-form-label--sm" style={{ fontSize: 11, marginBottom: 4 }}>{t('scan.book_author')}</label>
                      <input
                        className="sh-input"
                        value={book.author ?? ''}
                        onChange={e => updateBook(book.localId, 'author', e.target.value || null)}
                        placeholder={t('scan.book_author_placeholder')}
                        style={{ fontSize: 14 }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {editableBooks.length === 0 && (
            <div className="sh-empty-state" style={{ padding: 40 }}>
              <p>{t('scan.no_books_found')}</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => { setStep('scan') }}
              style={{
                flex: 1, padding: '14px', fontSize: 15,
                background: 'none', border: '1px solid var(--sh-border)',
                borderRadius: 'var(--sh-radius-md)', cursor: 'pointer',
                color: 'var(--sh-text-muted)',
              }}
            >
              ← {t('scan.back_to_scan')}
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
