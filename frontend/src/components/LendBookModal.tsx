import { useState } from 'react'

import { useCreateLoan } from '../hooks/useLoans'

export function LendBookModal({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [borrowerName, setBorrowerName] = useState('')
  const [borrowerContact, setBorrowerContact] = useState('')
  const [lentDate, setLentDate] = useState(today)
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const createLoan = useCreateLoan(bookId)

  return (
    <div role="dialog" aria-label="lend-book-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 200 }}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!borrowerName.trim()) {
            setError('Borrower name is required.')
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
              onError: () => setError('Unable to lend this book.'),
            },
          )
        }}
        style={{ width: '100%', maxWidth: 520, background: 'var(--sh-surface)', border: '1px solid var(--sh-border)', borderRadius: 'var(--sh-radius-xl)', padding: 24, display: 'grid', gap: 12 }}
      >
        <h3 style={{ margin: 0 }}>Lend book</h3>
        <input className="sh-input" placeholder="Borrower name" value={borrowerName} onChange={(event) => setBorrowerName(event.target.value)} required />
        <input className="sh-input" placeholder="email or phone" value={borrowerContact} onChange={(event) => setBorrowerContact(event.target.value)} />
        <label>Lent date<input className="sh-input" type="date" value={lentDate} onChange={(event) => setLentDate(event.target.value)} /></label>
        <label>Due date<input className="sh-input" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
        <textarea className="sh-input" placeholder="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
        {error && <p style={{ margin: 0, color: 'var(--sh-red)' }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="sh-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="sh-btn-primary" disabled={createLoan.isPending}>{createLoan.isPending ? 'Lending…' : 'Lend book'}</button>
        </div>
      </form>
    </div>
  )
}
