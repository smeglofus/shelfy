import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useBorrowers } from '../hooks/useBorrowers'
import { useDebounce } from '../hooks/useDebounce'
import { useCreateLoan } from '../hooks/useLoans'
import type { Borrower, LoanCreateRequest } from '../lib/types'
import { Modal } from './Modal'

const PICKER_PAGE_SIZE = 100

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Returns every borrower whose normalized name equals the typed value.
 *
 * Empty input returns ``[]`` (no candidates rather than every borrower). Used
 * by the modal to decide between three states:
 *
 * - 0 matches → typed-name flow (legacy / new borrower)
 * - 1 match   → auto-link by id
 * - >1 match  → ask the user to disambiguate (#250)
 */
function findAllMatches(borrowers: Borrower[], typed: string): Borrower[] {
  const target = normalize(typed)
  if (!target) return []
  return borrowers.filter((b) => normalize(b.name) === target)
}

export function LendBookModal({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [borrowerName, setBorrowerName] = useState('')
  const [borrowerContact, setBorrowerContact] = useState('')
  const [lentDate, setLentDate] = useState(today)
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const createLoan = useCreateLoan(bookId)
  const { t } = useTranslation()
  // Server-side search-as-you-type (#250 follow-up). Mirrors the merge picker:
  // 250 ms debounce on the typed name, fetch one page of up to 100 results.
  // The empty-string case is handled by ``listBorrowers`` (passes
  // ``search=undefined`` so the server returns the unfiltered first page,
  // which keeps the open-the-modal-and-glance UX intact).
  //
  // Why this matters: with the old "load first 100 once" approach, a library
  // with >100 borrowers could silently produce duplicate Borrower rows for a
  // borrower that happened to land on page 2+ — the matcher never saw them,
  // fell through to the typed-name flow, and ``create_loan`` happily made a
  // new record. With debounced search the typed name is sent to the server,
  // which finds the match regardless of pagination position.
  const debouncedName = useDebounce(borrowerName, 250)
  const borrowersQuery = useBorrowers({
    search: debouncedName,
    page: 1,
    pageSize: PICKER_PAGE_SIZE,
  })
  // Anonymized borrowers are excluded from the picker — there's no sensible
  // reason to lend a new book to one (and they all carry the same sentinel
  // name, which would clutter the suggestions).
  const borrowers = useMemo(
    () => (borrowersQuery.data?.items ?? []).filter((b) => b.anonymized_at === null),
    [borrowersQuery.data],
  )

  // Track explicit disambiguation picks. When the user clicks a row in the
  // multi-match list, we pin the choice here. The pin survives small edits to
  // the contact field but is cleared whenever the name input changes — a
  // different name implies the user backed out of the previous pick.
  const [selectedBorrowerId, setSelectedBorrowerId] = useState<string | null>(null)

  const matches = useMemo(
    () => findAllMatches(borrowers, borrowerName),
    [borrowers, borrowerName],
  )

  // Resolve the linked borrower in priority order:
  //   1. Explicit pick from the disambiguation list.
  //   2. Sole match (preserves the unambiguous-name shortcut).
  //   3. Nothing — fall through to typed-name flow.
  const linkedBorrower = useMemo<Borrower | null>(() => {
    if (selectedBorrowerId) {
      return matches.find((b) => b.id === selectedBorrowerId) ?? null
    }
    return matches.length === 1 ? matches[0] : null
  }, [matches, selectedBorrowerId])

  // Clear the explicit pick when the typed name changes such that the pick
  // is no longer in the match set (e.g., the user retypes a different name).
  // We avoid clearing on every keystroke so a transient empty match set
  // (mid-typing) doesn't lose the pick.
  useEffect(() => {
    if (selectedBorrowerId && !matches.some((b) => b.id === selectedBorrowerId)) {
      setSelectedBorrowerId(null)
    }
  }, [matches, selectedBorrowerId])

  return (
    <Modal open label={t('loans.lend_modal_title')} onClose={onClose} maxWidth={520}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!borrowerName.trim()) {
            setError(t('loans.borrower_name_required'))
            return
          }

          // When the typed name uniquely matches an existing borrower (or the
          // user picked one from the disambiguation list — #250), link by
          // borrower_id and let the backend supply name/contact. The typed
          // contact is intentionally ignored — a loan form should not
          // overwrite borrower details (issue #224).
          const payload: LoanCreateRequest = linkedBorrower
            ? {
                borrower_id: linkedBorrower.id,
                lent_date: lentDate,
                due_date: dueDate || null,
                notes: notes.trim() || null,
              }
            : {
                borrower_name: borrowerName.trim(),
                borrower_contact: borrowerContact.trim() || null,
                lent_date: lentDate,
                due_date: dueDate || null,
                notes: notes.trim() || null,
              }

          createLoan.mutate(payload, {
            onSuccess: () => onClose(),
            onError: () => setError(t('loans.lend_error')),
          })
        }}
        style={{ display: 'grid', gap: 12 }}
      >
        <h3 style={{ margin: 0 }}>{t('loans.lend_modal_title')}</h3>
        <div style={{ display: 'grid', gap: 4 }}>
          <input
            className="sh-input"
            list="borrower-suggestions"
            placeholder={t('loans.borrower_name')}
            value={borrowerName}
            onChange={(event) => setBorrowerName(event.target.value)}
            autoComplete="off"
            required
          />
          <datalist id="borrower-suggestions" data-testid="borrower-suggestions">
            {borrowers.map((borrower) => (
              <option key={borrower.id} value={borrower.name} />
            ))}
          </datalist>
          {linkedBorrower && (
            <span
              data-testid="borrower-existing-match"
              style={{ fontSize: 12, color: 'var(--sh-text-muted)' }}
            >
              {t('loans.borrower_existing_match')}
              {linkedBorrower.contact ? ` · ${linkedBorrower.contact}` : ''}
            </span>
          )}
          {!linkedBorrower && matches.length > 1 && (
            <div
              data-testid="borrower-disambiguation"
              style={{
                marginTop: 4,
                padding: 12,
                border: '1px solid var(--sh-yellow, #facc15)',
                borderRadius: 'var(--sh-radius-md)',
                background: 'var(--sh-yellow-soft, #fffbe6)',
                fontSize: 13,
              }}
            >
              <p style={{ margin: '0 0 6px', fontWeight: 500 }}>
                {t('loans.borrower_ambiguous_hint', { count: matches.length })}
              </p>
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'grid',
                  gap: 4,
                }}
              >
                {matches.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      data-testid={`borrower-disambiguation-${candidate.id}`}
                      className="sh-btn-secondary"
                      style={{
                        width: '100%',
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        padding: '6px 10px',
                      }}
                      onClick={() => setSelectedBorrowerId(candidate.id)}
                    >
                      {candidate.name}
                      {candidate.contact ? ` · ${candidate.contact}` : ''}
                    </button>
                  </li>
                ))}
              </ul>
              <p
                style={{
                  margin: '6px 0 0',
                  fontSize: 12,
                  color: 'var(--sh-text-muted)',
                }}
              >
                {t('loans.borrower_ambiguous_fallback')}
              </p>
            </div>
          )}
        </div>
        <input
          className="sh-input"
          placeholder={t('loans.borrower_contact')}
          value={borrowerContact}
          onChange={(event) => setBorrowerContact(event.target.value)}
          disabled={Boolean(linkedBorrower)}
        />
        <label style={{ display: 'grid', gap: 4, fontSize: 14, fontWeight: 500, color: 'var(--sh-text-muted)' }}>
          {t('loans.lent_date')}
          <input className="sh-input" type="date" value={lentDate} onChange={(event) => setLentDate(event.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 14, fontWeight: 500, color: 'var(--sh-text-muted)' }}>
          {t('loans.due_date')}
          <input className="sh-input" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>
        <textarea className="sh-input" rows={3} placeholder={t('loans.notes')} value={notes} onChange={(event) => setNotes(event.target.value)}
          maxLength={2000}
        />
        {error && <p style={{ margin: 0, color: 'var(--sh-red)', fontSize: 14 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" className="sh-btn-secondary" onClick={onClose}>{t('loans.cancel')}</button>
          <button type="submit" className="sh-btn-primary" disabled={createLoan.isPending}>{createLoan.isPending ? t('loans.lending') : t('loans.lend_submit')}</button>
        </div>
      </form>
    </Modal>
  )
}
