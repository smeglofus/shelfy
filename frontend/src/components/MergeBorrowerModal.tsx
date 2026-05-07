import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useBorrowers, useMergeBorrowers } from '../hooks/useBorrowers'
import { useDebounce } from '../hooks/useDebounce'
import { displayBorrowerName } from '../lib/borrowerDisplay'
import { getBorrowerDetailRoute } from '../lib/routes'
import type { Borrower, BorrowerListItem } from '../lib/types'
import { Modal } from './Modal'

interface Props {
  /** The borrower the user is currently viewing — this is the SOURCE of the
   *  merge (the record that gets deleted). The picker chooses the TARGET
   *  (the record that survives). This direction matches the issue spec
   *  ("Merge into another…") and the Edit / Anonymize buttons that also
   *  act on the currently-viewed record. */
  borrower: Borrower
  onClose: () => void
}

const PICKER_PAGE_SIZE = 100

/**
 * "Merge this borrower into another" flow:
 *
 *   step 1 — pick the target borrower (search-as-you-type, anonymized + the
 *            current borrower itself filtered out)
 *   step 2 — confirm with explicit "this cannot be undone" warning
 *
 * On confirm we POST to ``/api/v1/borrowers/{target.id}/merge`` with
 * ``source_id = current.id``, then navigate to the target's detail page —
 * the source record we were viewing is deleted by the backend, so staying
 * on the current URL would 404.
 */
export function MergeBorrowerModal({ borrower, onClose }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchInput, setSearchInput] = useState('')
  const [picked, setPicked] = useState<BorrowerListItem | null>(null)
  const debouncedSearch = useDebounce(searchInput, 250)
  const merge = useMergeBorrowers()

  // ``pageSize: 100`` mirrors LendBookModal: large enough that a typical
  // library shows everything in one shot, with the ``search`` field as the
  // escape hatch for libraries that exceed the cap.
  const borrowersQuery = useBorrowers({
    search: debouncedSearch,
    page: 1,
    pageSize: PICKER_PAGE_SIZE,
  })

  const candidates = useMemo(
    () =>
      (borrowersQuery.data?.items ?? []).filter(
        (b) => b.id !== borrower.id && b.anonymized_at === null,
      ),
    [borrowersQuery.data, borrower.id],
  )

  const totalMatching = borrowersQuery.data?.total ?? 0
  // The "X of Y" indicator counts the borrowers we filtered out client-side
  // so the user isn't confused when the server says "100 results" but the
  // list shows 99 (because we hid their own record).
  const hiddenSelf = (borrowersQuery.data?.items ?? []).some((b) => b.id === borrower.id) ? 1 : 0
  const totalAvailable = Math.max(0, totalMatching - hiddenSelf)
  const truncated = totalAvailable > candidates.length

  const sourceName = displayBorrowerName(borrower, t)
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
              {t('borrowers.merge_picker_hint', { source: sourceName })}
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
              <>
                {truncated && (
                  <p
                    data-testid="merge-truncated-hint"
                    style={{
                      margin: 0,
                      color: 'var(--sh-text-muted)',
                      fontSize: 12,
                    }}
                  >
                    {t('borrowers.merge_truncated_hint', {
                      shown: candidates.length,
                      total: totalAvailable,
                    })}
                  </p>
                )}
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
              </>
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
                source: sourceName,
                target: pickedName,
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
                  // The current borrower is the *source* — it gets deleted.
                  // Navigate to the target so we don't sit on a 404'd URL.
                  const targetId = picked.id
                  merge.mutate(
                    { targetId, sourceId: borrower.id },
                    {
                      onSuccess: () => {
                        onClose()
                        navigate(getBorrowerDetailRoute(targetId), { replace: true })
                      },
                    },
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
