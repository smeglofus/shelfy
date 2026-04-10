/**
 * ImportCsvModal — 2-step CSV import flow.
 *
 * Step 1: User picks a file → preview is fetched from the backend.
 *         Summary counters + first N rows are shown.  Error list is
 *         displayed when the CSV has invalid rows.
 *
 * Step 2: User reviews preview and confirms with import options
 *         (mode, on_conflict, create_missing_locations).
 *         On success the parent is notified so it can re-fetch the book list.
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { confirmCsvImport, formatApiError, previewCsvImport } from '../lib/api'
import type { CsvImportConfirmRequest, CsvImportPreviewResponse } from '../lib/types'
import Modal from './Modal'

interface ImportCsvModalProps {
  open: boolean
  onClose: () => void
  onImported: () => void
}

type Step = 'pick' | 'preview' | 'confirming' | 'done'

const MAX_ERROR_DISPLAY = 10

export function ImportCsvModal({ open, onClose, onImported }: ImportCsvModalProps) {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('pick')
  const [preview, setPreview] = useState<CsvImportPreviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Import options
  const [mode, setMode] = useState<'upsert' | 'create_only'>('upsert')
  const [onConflict, setOnConflict] = useState<'update' | 'skip'>('update')
  const [createMissingLocations, setCreateMissingLocations] = useState(false)

  // Result (step=done)
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null)

  function reset() {
    setStep('pick')
    setPreview(null)
    setError(null)
    setResult(null)
    setMode('upsert')
    setOnConflict('update')
    setCreateMissingLocations(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    setError(null)

    try {
      const data = await previewCsvImport(file)
      setPreview(data)
      setStep('preview')
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    if (!preview) return

    setStep('confirming')
    setError(null)

    const payload: CsvImportConfirmRequest = {
      import_token: preview.import_token,
      mode,
      on_conflict: onConflict,
      create_missing_locations: createMissingLocations,
    }

    try {
      const data = await confirmCsvImport(payload)
      setResult({ created: data.created, updated: data.updated, skipped: data.skipped })
      setStep('done')
      onImported()
    } catch (err) {
      setError(formatApiError(err))
      setStep('preview')
    }
  }

  const { summary, errors: parseErrors, preview_rows: previewRows } = preview ?? {}

  return (
    <Modal open={open} onClose={handleClose} label={t('csv.import_modal_label')} size="lg">
      <h2
        style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}
      >
        {t('csv.import_title')}
      </h2>

      {/* ── Step: pick file ── */}
      {step === 'pick' && (
        <div>
          <p style={{ margin: '0 0 12px', color: 'var(--sh-text-muted)', fontSize: 14 }}>
            {t('csv.import_description')}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            disabled={loading}
            style={{ display: 'block', marginBottom: 12 }}
            data-testid="csv-file-input"
          />
          {loading && (
            <p style={{ color: 'var(--sh-text-muted)', fontSize: 13 }}>{t('csv.parsing')}</p>
          )}
          {error && (
            <p style={{ color: 'var(--sh-danger)', fontSize: 13, marginTop: 8 }}>{error}</p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="sh-btn-secondary" onClick={handleClose}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* ── Step: preview ── */}
      {(step === 'preview' || step === 'confirming') && preview && summary && (
        <div>
          {/* Summary counters */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
              gap: 8,
              marginBottom: 16,
            }}
          >
            {[
              { label: t('csv.total_rows'), value: summary.total_rows },
              { label: t('csv.valid_rows'), value: summary.valid_rows, color: 'var(--sh-primary-text)' },
              { label: t('csv.invalid_rows'), value: summary.invalid_rows, color: summary.invalid_rows > 0 ? 'var(--sh-danger)' : undefined },
              { label: t('csv.would_create'), value: summary.would_create, color: 'var(--sh-primary-text)' },
              { label: t('csv.would_update'), value: summary.would_update },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                style={{
                  border: '1px solid var(--sh-border)',
                  borderRadius: 'var(--sh-radius-md)',
                  padding: '8px 12px',
                  textAlign: 'center',
                  background: 'var(--sh-surface)',
                }}
              >
                <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
                <div style={{ fontSize: 11, color: 'var(--sh-text-muted)', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Parse errors */}
          {parseErrors && parseErrors.length > 0 && (
            <div
              style={{
                marginBottom: 16,
                border: '1px solid var(--sh-danger-bg)',
                borderRadius: 'var(--sh-radius-md)',
                padding: '8px 12px',
                background: 'var(--sh-danger-bg)',
              }}
            >
              <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: 'var(--sh-danger-text)' }}>
                {t('csv.parse_errors_title', { count: parseErrors.length })}
              </p>
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {parseErrors.slice(0, MAX_ERROR_DISPLAY).map((e) => (
                  <li key={`${e.row}-${e.error}`} style={{ fontSize: 12, color: 'var(--sh-danger-text)', marginBottom: 2 }}>
                    {e.error}
                  </li>
                ))}
                {parseErrors.length > MAX_ERROR_DISPLAY && (
                  <li style={{ fontSize: 12, color: 'var(--sh-danger-text)' }}>
                    {t('csv.parse_errors_more', { count: parseErrors.length - MAX_ERROR_DISPLAY })}
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Preview table */}
          {previewRows && previewRows.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--sh-text-muted)' }}>
                {t('csv.preview_table_label', { count: previewRows.length })}
              </p>
              <div style={{ overflowX: 'auto', border: '1px solid var(--sh-border)', borderRadius: 'var(--sh-radius-md)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--sh-surface-elevated)' }}>
                      {['title', 'author', 'isbn', 'reading_status', 'room', 'shelf'].map((col) => (
                        <th
                          key={col}
                          style={{
                            padding: '6px 10px',
                            textAlign: 'left',
                            borderBottom: '1px solid var(--sh-border)',
                            color: 'var(--sh-text-muted)',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--sh-border)' }}>
                        <td style={{ padding: '5px 10px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</td>
                        <td style={{ padding: '5px 10px', color: 'var(--sh-text-muted)' }}>{row.author ?? '—'}</td>
                        <td style={{ padding: '5px 10px', color: 'var(--sh-text-muted)' }}>{row.isbn ?? '—'}</td>
                        <td style={{ padding: '5px 10px', color: 'var(--sh-text-muted)' }}>{row.reading_status ?? '—'}</td>
                        <td style={{ padding: '5px 10px', color: 'var(--sh-text-muted)' }}>{row.room ?? '—'}</td>
                        <td style={{ padding: '5px 10px', color: 'var(--sh-text-muted)' }}>{row.shelf ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Import options */}
          <div
            style={{
              border: '1px solid var(--sh-border)',
              borderRadius: 'var(--sh-radius-md)',
              padding: '10px 14px',
              marginBottom: 16,
              background: 'var(--sh-surface)',
              display: 'grid',
              gap: 8,
            }}
          >
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t('csv.options_title')}</p>

            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={createMissingLocations}
                onChange={(e) => setCreateMissingLocations(e.target.checked)}
              />
              {t('csv.create_missing_locations')}
            </label>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                {t('csv.mode_label')}
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'upsert' | 'create_only')}
                  style={{ fontSize: 12, padding: '2px 6px' }}
                >
                  <option value="upsert">{t('csv.mode_upsert')}</option>
                  <option value="create_only">{t('csv.mode_create_only')}</option>
                </select>
              </label>

              {mode === 'upsert' && (
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {t('csv.on_conflict_label')}
                  <select
                    value={onConflict}
                    onChange={(e) => setOnConflict(e.target.value as 'update' | 'skip')}
                    style={{ fontSize: 12, padding: '2px 6px' }}
                  >
                    <option value="update">{t('csv.on_conflict_update')}</option>
                    <option value="skip">{t('csv.on_conflict_skip')}</option>
                  </select>
                </label>
              )}
            </div>
          </div>

          {error && (
            <p style={{ color: 'var(--sh-danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <button type="button" className="sh-btn-secondary" onClick={reset}>
              {t('csv.back')}
            </button>
            <button
              type="button"
              className="sh-btn-primary"
              onClick={handleConfirm}
              disabled={step === 'confirming' || summary.valid_rows === 0}
              data-testid="csv-confirm-btn"
            >
              {step === 'confirming'
                ? t('csv.importing')
                : t('csv.confirm_import', { count: summary.valid_rows })}
            </button>
          </div>
        </div>
      )}

      {/* ── Step: done ── */}
      {step === 'done' && result && (
        <div>
          <p
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--sh-radius-md)',
              background: 'var(--sh-primary-bg)',
              color: 'var(--sh-primary-text)',
              fontSize: 14,
              marginBottom: 16,
            }}
          >
            {t('csv.import_done')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
            {[
              { label: t('csv.result_created'), value: result.created },
              { label: t('csv.result_updated'), value: result.updated },
              { label: t('csv.result_skipped'), value: result.skipped },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  border: '1px solid var(--sh-border)',
                  borderRadius: 'var(--sh-radius-md)',
                  padding: '8px 12px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
                <div style={{ fontSize: 11, color: 'var(--sh-text-muted)', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="sh-btn-primary" onClick={handleClose}>
              {t('common.close')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
