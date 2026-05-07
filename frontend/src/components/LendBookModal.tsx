import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useBorrowers } from '../hooks/useBorrowers'
import { useCreateLoan } from '../hooks/useLoans'
import type { Borrower, LoanCreateRequest } from '../lib/types'
import { Modal } from './Modal'

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Returns the unique borrower whose normalized name equals the typed value, or null. */
function findExactMatch(borrowers: Borrower[], typed: string): Borrower | null {
  const target = normalize(typed)
  if (!target) return null
  const matches = borrowers.filter((b) => normalize(b.name) === target)
  return matches.length === 1 ? matches[0] : null
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
  const borrowersQuery = useBorrowers()
  // Anonymized borrowers are excluded from the picker — there's no sensible
  // reason to lend a new book to one (and they all carry the same sentinel
  // name, which would clutter the suggestions).
  const borrowers = useMemo(
    () => (borrowersQuery.data ?? []).filter((b) => b.anonymized_at === null),
    [borrowersQuery.data],
  )

  const matchedBorrower = useMemo(
    () => findExactMatch(borrowers, borrowerName),
    [borrowers, borrowerName],
  )

  return (
    <Modal open label={t('loans.lend_modal_title')} onClose={onClose} maxWidth={520}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!borrowerName.trim()) {
            setError(t('loans.borrower_name_required'))
            return
          }

          // When the typed name uniquely matches an existing borrower, link by
          // borrower_id and let the backend supply name/contact. The typed
          // contact is intentionally ignored — a loan form should not
          // overwrite borrower details (issue #224).
          const payload: LoanCreateRequest = matchedBorrower
            ? {
                borrower_id: matchedBorrower.id,
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
          {matchedBorrower && (
            <span
              data-testid="borrower-existing-match"
              style={{ fontSize: 12, color: 'var(--sh-text-muted)' }}
            >
              {t('loans.borrower_existing_match')}
              {matchedBorrower.contact ? ` · ${matchedBorrower.contact}` : ''}
            </span>
          )}
        </div>
        <input
          className="sh-input"
          placeholder={t('loans.borrower_contact')}
          value={borrowerContact}
          onChange={(event) => setBorrowerContact(event.target.value)}
          disabled={Boolean(matchedBorrower)}
        />
        <label style={{ display: 'grid', gap: 4, fontSize: 14, fontWeight: 500, color: 'var(--sh-text-muted)' }}>
          {t('loans.lent_date')}
          <input className="sh-input" type="date" value={lentDate} onChange={(event) => setLentDate(event.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 14, fontWeight: 500, color: 'var(--sh-text-muted)' }}>
          {t('loans.due_date')}
          <input className="sh-input" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>
        <textarea className="sh-input" rows={3} placeholder={t('loans.notes')} value={notes} onChange={(event) => setNotes(event.target.value)} />
        {error && <p style={{ margin: 0, color: 'var(--sh-red)', fontSize: 14 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" className="sh-btn-secondary" onClick={onClose}>{t('loans.cancel')}</button>
          <button type="submit" className="sh-btn-primary" disabled={createLoan.isPending}>{createLoan.isPending ? t('loans.lending') : t('loans.lend_submit')}</button>
        </div>
      </form>
    </Modal>
  )
}
