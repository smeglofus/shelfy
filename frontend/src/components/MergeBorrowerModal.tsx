import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useBorrowers, useMergeBorrowers } from '../hooks/useBorrowers'
import { useDebounce } from '../hooks/useDebounce'
import { displayBorrowerName } from '../lib/borrowerDisplay'
import type { Borrower, BorrowerListItem } from '../lib/types'
import { Modal } from './Modal'

interface Props {
  /** The "keep this one" borrower — current detail page. */
  target: Borrower
  onClose: () => void
}

const SEARCH_PAGE_SIZE = 20

/**
 * "Merge another borrower into this one" flow:
 *
 *   step 1 — pick a source borrower (search-as-you-type, anonymized + the
 *            target itself filtered out)
 *   step 2 — confirm with explicit "this cannot be undone" warning
 *
 * Calls `POST /api/v1/borrowers/{target.id}/merge` on confirm.
 */
export function MergeBorrowerModal({ target, onClose }: Props) {
  const { t } = useTranslation()
  const [searchInput, setSearchInput] = useState('')
  const [picked, setPicked] = useState<BorrowerListItem | null>(null)
  const debouncedSearch = useDebounce(searchInput, 250)
  const merge = useMergeBorrowers()

  const borrowersQuery = useBorrowers({
    search: debouncedSearch,
    page: 1,
    pageSize: SEARCH_PAGE_SIZE,
  })

  const candidates = useMemo(
    () =>
      (borrowersQuery.data?.items ?? []).filter(
        (b) => b.id !== target.id && b.anonymized_at === null,
      ),
    [borrowersQuery.data, target.id],
  )

  const targetName = displayBorrowerName(target, t)
  const pickedName = picked ? displayBorrowerName(picked, t) : ''

  return (
    <Modal
      open
      onClose={onClose}
      label={t('borrowers.merge_modal_title')}
      maxWidth={520}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <h3 style={{ margin: 0 }}>{t('borrowers.merge_modal_title')}</h3>

        {!picked && (
          <>
            <p style={{ margin: 0, color: 'var(--sh-text-muted)', fontSize: 13 }}>
              {t('borrowers.merge_picker_hint', { target: targetName })}
            </p>
            <input
              type="search"
              className="sh-input"
              placeholder={t('borrowers.search_placeholder')}
              aria-label={t('borrowers.search_placeholder')}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              data-testid="merge-source-search"
            />
            {borrowersQuery.isLoading && (
              <p style={{ margin: 0, color: 'var(--sh-text-muted)', fontSize: 13 }}>
                {t('borrowers.loading')}
              </p>
            )}
            {!borrowersQuery.isLoading && candidates.length === 0 && (
              <p
                data-testid="merge-no-candidates"
                style={{ margin: 0, color: 'var(--sh-text-muted)', fontSize: 13 }}
              >
                {debouncedSearch
                  ? t('borrowers.no_results', { query: debouncedSearch })
                  : t('borrowers.merge_no_candidates')}
              </p>
            )}
            {!borrowersQuery.isLoading && candidates.length > 0 && (
              <ul
                data-testid="merge-source-list"
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'grid',
                  gap: 4,
                  maxHeight: 240,
                  overflowY: 'auto',
                }}
              >
                {candidates.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      data-testid={`merge-source-${candidate.id}`}
                      onClick={() => setPicked(candidate)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: 10,
                        background: 'var(--sh-surface)',
                        border: '1px solid var(--sh-border)',
                        borderRadius: 'var(--sh-radius-md)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontWeight: 500 }}>{candidate.name}</div>
                      {candidate.contact && (
                        <div style={{ fontSize: 12, color: 'var(--sh-text-muted)' }}>
                          {candidate.contact}
                        </div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" className="sh-btn-secondary" onClick={onClose}>
                {t('common.cancel')}
              </button>
            </div>
          </>
        )}

        {picked && (
          <>
            <p data-testid="merge-confirm-body" style={{ margin: 0 }}>
              {t('borrowers.merge_confirm_body', {
                source: pickedName,
                target: targetName,
              })}
            </p>
            <p style={{ margin: 0, color: 'var(--sh-red)', fontWeight: 500 }}>
              {t('borrowers.merge_irreversible')}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                className="sh-btn-secondary"
                onClick={() => setPicked(null)}
                disabled={merge.isPending}
              >
                {t('borrowers.merge_back')}
              </button>
              <button
                type="button"
                data-testid="merge-confirm"
                className="sh-btn-primary"
                style={{ background: 'var(--sh-red)' }}
                disabled={merge.isPending}
                onClick={() => {
                  merge.mutate(
                    { targetId: target.id, sourceId: picked.id },
                    { onSuccess: () => onClose() },
                  )
                }}
              >
                {merge.isPending ? t('borrowers.merging') : t('borrowers.merge_confirm')}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
