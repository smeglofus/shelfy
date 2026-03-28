import { useMemo, useState } from 'react'
import { formatDateDDMMYYYY } from '../lib/date'
import { useTranslation } from 'react-i18next'

import { useLoans } from '../hooks/useLoans'
import { LendBookModal } from './LendBookModal'
import { ReturnBookModal } from './ReturnBookModal'

export function LoanHistory({ bookId }: { bookId: string }) {
  const loansQuery = useLoans(bookId)
  const [showLend, setShowLend] = useState(false)
  const [activeReturnLoanId, setActiveReturnLoanId] = useState<string | null>(null)
  const { t } = useTranslation()

  const loans = useMemo(() => [...(loansQuery.data ?? [])].sort((a, b) => (a.lent_date < b.lent_date ? 1 : -1)), [loansQuery.data])

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 className="text-h3" style={{ margin: 0 }}>{t('loans.history_title')}</h3>
        <button type="button" className="sh-btn-secondary" onClick={() => setShowLend(true)}>{t('loans.lend_button')}</button>
      </div>

      {loans.length === 0 && !loansQuery.isLoading && (
        <div style={{ border: '1px dashed var(--sh-border)', borderRadius: 'var(--sh-radius-lg)', padding: 16 }}>
          <p style={{ marginTop: 0 }}>{t('loans.empty_title')}</p>
          <button type="button" className="sh-btn-primary" onClick={() => setShowLend(true)}>{t('loans.lend_this_book')}</button>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {loans.map((loan) => (
          <article key={loan.id} style={{ border: `1px solid ${loan.is_active ? 'var(--sh-amber)' : 'var(--sh-border)'}`, background: loan.is_active ? 'var(--sh-amber-bg)' : 'var(--sh-surface)', borderRadius: 'var(--sh-radius-md)', padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{loan.borrower_name}</strong>
              <span>{loan.is_active ? t('loans.active') : t('loans.returned')}</span>
            </div>
            <p style={{ marginBottom: 0, color: 'var(--sh-text-muted)' }}>{formatDateDDMMYYYY(loan.lent_date)} {loan.returned_date ? `– ${formatDateDDMMYYYY(loan.returned_date)}` : loan.due_date ? `• ${t('loans.due')} ${formatDateDDMMYYYY(loan.due_date)}` : ''}</p>
            {!loan.is_active && loan.return_condition && <p style={{ marginBottom: 0 }}>{t('loans.returned_condition', { condition: loan.return_condition })}</p>}
            {loan.notes && <p style={{ marginBottom: 0 }}>{loan.notes}</p>}
            {loan.is_active && <button type="button" className="sh-btn-primary" style={{ marginTop: 8 }} onClick={() => setActiveReturnLoanId(loan.id)}>{t('loans.mark_returned')}</button>}
          </article>
        ))}
      </div>

      {showLend && <LendBookModal bookId={bookId} onClose={() => setShowLend(false)} />}
      {activeReturnLoanId && <ReturnBookModal bookId={bookId} loanId={activeReturnLoanId} onClose={() => setActiveReturnLoanId(null)} />}
    </section>
  )
}
