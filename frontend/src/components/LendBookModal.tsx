import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCreateLoan } from '../hooks/useLoans'
import { Modal } from './Modal'

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

  return (
    <Modal open label={t('loans.lend_modal_title')} onClose={onClose} maxWidth={520}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!borrowerName.trim()) {
            setError(t('loans.borrower_name_required'))
            return
          }

          createLoan.mutate(
            {
              borrower_name: borrowerName.trim(),
              borrower_contact: borrowerContact.trim() || null,
              lent_date: lentDate,
              due_date: dueDate || null,
              notes: notes.trim() || null,
            },
            {
              onSuccess: () => onClose(),
              onError: () => setError(t('loans.lend_error')),
            },
          )
        }}
        style={{ display: 'grid', gap: 12 }}
      >
        <h3 style={{ margin: 0 }}>{t('loans.lend_modal_title')}</h3>
        <input className="sh-input" placeholder={t('loans.borrower_name')} value={borrowerName} onChange={(event) => setBorrowerName(event.target.value)} required />
        <input className="sh-input" placeholder={t('loans.borrower_contact')} value={borrowerContact} onChange={(event) => setBorrowerContact(event.target.value)} />
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
