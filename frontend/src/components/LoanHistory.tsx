import { useMemo, useState } from 'react'

import { useLoans } from '../hooks/useLoans'
import { LendBookModal } from './LendBookModal'
import { ReturnBookModal } from './ReturnBookModal'

export function LoanHistory({ bookId }: { bookId: string }) {
  const loansQuery = useLoans(bookId)
  const [showLend, setShowLend] = useState(false)
  const [activeReturnLoanId, setActiveReturnLoanId] = useState<string | null>(null)

  const loans = useMemo(() => [...(loansQuery.data ?? [])].sort((a, b) => (a.lent_date < b.lent_date ? 1 : -1)), [loansQuery.data])

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 className="text-h3" style={{ margin: 0 }}>Lending history</h3>
        <button type="button" className="sh-btn-secondary" onClick={() => setShowLend(true)}>+ Lend book</button>
      </div>

      {loans.length === 0 && !loansQuery.isLoading && (
        <div style={{ border: '1px dashed var(--sh-border)', borderRadius: 'var(--sh-radius-lg)', padding: 16 }}>
          <p style={{ marginTop: 0 }}>No lending history yet.</p>
          <button type="button" className="sh-btn-primary" onClick={() => setShowLend(true)}>Lend this book</button>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {loans.map((loan) => (
          <article key={loan.id} style={{ border: `1px solid ${loan.is_active ? 'var(--sh-amber)' : 'var(--sh-border)'}`, background: loan.is_active ? 'var(--sh-amber-bg)' : 'var(--sh-surface)', borderRadius: 'var(--sh-radius-md)', padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{loan.borrower_name}</strong>
              <span>{loan.is_active ? 'Active' : 'Returned'}</span>
            </div>
            <p style={{ marginBottom: 0, color: 'var(--sh-text-muted)' }}>{loan.lent_date} {loan.returned_date ? `– ${loan.returned_date}` : loan.due_date ? `• due ${loan.due_date}` : ''}</p>
            {!loan.is_active && loan.return_condition && <p style={{ marginBottom: 0 }}>Returned in {loan.return_condition} condition</p>}
            {loan.notes && <p style={{ marginBottom: 0 }}>{loan.notes}</p>}
            {loan.is_active && <button type="button" className="sh-btn-primary" style={{ marginTop: 8 }} onClick={() => setActiveReturnLoanId(loan.id)}>Mark as returned</button>}
          </article>
        ))}
      </div>

      {showLend && <LendBookModal bookId={bookId} onClose={() => setShowLend(false)} />}
      {activeReturnLoanId && <ReturnBookModal bookId={bookId} loanId={activeReturnLoanId} onClose={() => setActiveReturnLoanId(null)} />}
    </section>
  )
}
