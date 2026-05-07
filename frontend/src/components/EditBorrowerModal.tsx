import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useUpdateBorrower } from '../hooks/useBorrowers'
import type { Borrower } from '../lib/types'
import { Modal } from './Modal'

interface Props {
  borrower: Borrower
  onClose: () => void
}

export function EditBorrowerModal({ borrower, onClose }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState(borrower.name)
  const [contact, setContact] = useState(borrower.contact ?? '')
  const [notes, setNotes] = useState(borrower.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const updateMutation = useUpdateBorrower()

  return (
    <Modal open onClose={onClose} label={t('borrowers.edit_modal_title')} maxWidth={520}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim()) {
            setError(t('loans.borrower_name_required'))
            return
          }
          updateMutation.mutate(
            {
              id: borrower.id,
              payload: {
                name: name.trim(),
                contact: contact.trim() ? contact.trim() : null,
                notes: notes.trim() ? notes.trim() : null,
              },
            },
            {
              onSuccess: () => onClose(),
              onError: () => setError(t('borrowers.edit_error')),
            },
          )
        }}
        style={{ display: 'grid', gap: 12 }}
      >
        <h3 style={{ margin: 0 }}>{t('borrowers.edit_modal_title')}</h3>
        <p
          data-testid="edit-borrower-history-hint"
          style={{ margin: 0, color: 'var(--sh-text-muted)', fontSize: 13 }}
        >
          {t('borrowers.edit_history_hint')}
        </p>
        <label style={{ display: 'grid', gap: 4, fontSize: 14, fontWeight: 500, color: 'var(--sh-text-muted)' }}>
          {t('borrowers.field_name')}
          <input
            className="sh-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            data-testid="edit-borrower-name"
          />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 14, fontWeight: 500, color: 'var(--sh-text-muted)' }}>
          {t('borrowers.field_contact')}
          <input
            className="sh-input"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            data-testid="edit-borrower-contact"
          />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 14, fontWeight: 500, color: 'var(--sh-text-muted)' }}>
          {t('borrowers.field_notes')}
          <textarea
            className="sh-input"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            data-testid="edit-borrower-notes"
          />
        </label>
        {error && <p style={{ margin: 0, color: 'var(--sh-red)', fontSize: 14 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            type="button"
            className="sh-btn-secondary"
            onClick={onClose}
            disabled={updateMutation.isPending}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="sh-btn-primary"
            disabled={updateMutation.isPending}
            data-testid="edit-borrower-save"
          >
            {updateMutation.isPending ? t('borrowers.saving') : t('borrowers.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
