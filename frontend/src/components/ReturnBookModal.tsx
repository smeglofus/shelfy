import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useReturnLoan } from '../hooks/useLoans'

export function ReturnBookModal({ bookId, loanId, onClose }: { bookId: string; loanId: string; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [returnedDate, setReturnedDate] = useState(today)
  const [condition, setCondition] = useState<'perfect' | 'good' | 'fair' | 'damaged' | 'lost'>('good')
  const [notes, setNotes] = useState('')
  const returnLoan = useReturnLoan(bookId)
  const { t } = useTranslation()

  return (
    <div role="dialog" aria-label="return-book-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 200 }}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          returnLoan.mutate({ loanId, payload: { returned_date: returnedDate, return_condition: condition, notes: notes.trim() || null } }, { onSuccess: () => onClose() })
        }}
        style={{ width: '100%', maxWidth: 520, background: 'var(--sh-surface)', border: '1px solid var(--sh-border)', borderRadius: 'var(--sh-radius-xl)', padding: 24, display: 'grid', gap: 12 }}
      >
        <h3 style={{ margin: 0 }}>{t('loans.return_modal_title')}</h3>
        <label>{t('loans.return_date')}<input className="sh-input" type="date" value={returnedDate} onChange={(event) => setReturnedDate(event.target.value)} /></label>
        <label>{t('loans.return_condition')}
          <select className="sh-select" value={condition} onChange={(event) => setCondition(event.target.value as typeof condition)}>
            <option value="perfect">{t('loans.condition_perfect')}</option><option value="good">{t('loans.condition_good')}</option><option value="fair">{t('loans.condition_fair')}</option><option value="damaged">{t('loans.condition_damaged')}</option><option value="lost">{t('loans.condition_lost')}</option>
          </select>
        </label>
        <textarea className="sh-input" placeholder={t('loans.return_notes')} value={notes} onChange={(event) => setNotes(event.target.value)} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="sh-btn-secondary" onClick={onClose}>{t('loans.cancel')}</button>
          <button type="submit" className="sh-btn-primary" disabled={returnLoan.isPending}>{returnLoan.isPending ? t('loans.return_saving') : t('loans.return_submit')}</button>
        </div>
      </form>
    </div>
  )
}
