import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { bulkAnonymizeBorrowersByDate, formatApiError } from '../lib/api'
import { useToastStore } from '../lib/toast-store'
import { Modal } from './Modal'

interface Props {
  onClose: () => void
}

/**
 * Retention-driven bulk anonymize (#246). Two-step flow:
 *
 *   step 1 — pick the ``inactive_since`` cutoff date, then call the
 *            endpoint with ``dry_run: true`` to preview how many borrowers
 *            would be anonymized.
 *   step 2 — explicit "this cannot be undone" confirmation; calling the
 *            endpoint again with ``dry_run: false`` runs the action and
 *            invalidates the caches that carry borrower data.
 *
 * The user cannot reach step 2 without seeing the preview count first —
 * a deliberate guardrail because the action is irreversible at scale.
 */
export function BulkAnonymizeModal({ onClose }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)

  const [cutoff, setCutoff] = useState<string>('')
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [confirmStep, setConfirmStep] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePreview() {
    if (!cutoff) {
      setError(t('borrowers.bulk_anon_cutoff_required'))
      return
    }
    setError(null)
    setIsPreviewing(true)
    try {
      const result = await bulkAnonymizeBorrowersByDate({
        inactive_since: cutoff,
        dry_run: true,
      })
      setPreviewCount(result.affected)
      setConfirmStep(true)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setIsPreviewing(false)
    }
  }

  async function handleConfirm() {
    if (!cutoff) return
    setError(null)
    setIsConfirming(true)
    try {
      const result = await bulkAnonymizeBorrowersByDate({
        inactive_since: cutoff,
        dry_run: false,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['borrowers'] }),
        queryClient.invalidateQueries({ queryKey: ['borrower'] }),
        queryClient.invalidateQueries({ queryKey: ['loans'] }),
        queryClient.invalidateQueries({ queryKey: ['books'] }),
      ])
      showSuccess(
        t('toast.bulk_anonymized', { count: result.affected }),
      )
      onClose()
    } catch (err) {
      showError(formatApiError(err))
      setError(formatApiError(err))
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      label={t('borrowers.bulk_anon_title')}
      maxWidth={520}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <h3 style={{ margin: 0 }}>{t('borrowers.bulk_anon_title')}</h3>

        {!confirmStep && (
          <>
            <p style={{ margin: 0, color: 'var(--sh-text-muted)', fontSize: 13 }}>
              {t('borrowers.bulk_anon_picker_hint')}
            </p>
            <label
              style={{
                display: 'grid',
                gap: 4,
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--sh-text-muted)',
              }}
            >
              {t('borrowers.bulk_anon_cutoff_label')}
              <input
                className="sh-input"
                type="date"
                value={cutoff}
                onChange={(event) => setCutoff(event.target.value)}
                data-testid="bulk-anon-cutoff"
              />
            </label>
            {error && (
              <p style={{ margin: 0, color: 'var(--sh-red)', fontSize: 14 }}>{error}</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                className="sh-btn-secondary"
                onClick={onClose}
                disabled={isPreviewing}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="sh-btn-primary"
                onClick={handlePreview}
                disabled={isPreviewing}
                data-testid="bulk-anon-preview"
              >
                {isPreviewing
                  ? t('borrowers.bulk_anon_previewing')
                  : t('borrowers.bulk_anon_preview')}
              </button>
            </div>
          </>
        )}

        {confirmStep && previewCount !== null && (
          <>
            <p data-testid="bulk-anon-summary" style={{ margin: 0 }}>
              {t('borrowers.bulk_anon_summary', {
                count: previewCount,
                date: cutoff,
              })}
            </p>
            {previewCount > 0 && (
              <p
                style={{ margin: 0, color: 'var(--sh-red)', fontWeight: 500 }}
              >
                {t('borrowers.bulk_anon_irreversible')}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                className="sh-btn-secondary"
                onClick={() => {
                  setConfirmStep(false)
                  setPreviewCount(null)
                }}
                disabled={isConfirming}
              >
                {t('borrowers.bulk_anon_back')}
              </button>
              <button
                type="button"
                data-testid="bulk-anon-confirm"
                className="sh-btn-primary"
                style={previewCount > 0 ? { background: 'var(--sh-red)' } : undefined}
                onClick={handleConfirm}
                disabled={isConfirming || previewCount === 0}
              >
                {isConfirming
                  ? t('borrowers.bulk_anon_running')
                  : previewCount === 0
                    ? t('borrowers.bulk_anon_nothing_to_do')
                    : t('borrowers.bulk_anon_confirm')}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
