import type { TFunction } from 'i18next'

import type { Borrower } from './types'

/**
 * Resolve the borrower name to display in the UI.
 *
 * The backend writes a hard-coded sentinel ("Deleted borrower") when a
 * borrower is anonymized. We swap in the localized label for the user's
 * locale rather than relying on the DB string. For non-anonymized rows the
 * stored name is returned as-is.
 */
export function displayBorrowerName(
  borrower: Pick<Borrower, 'name' | 'anonymized_at'> | null | undefined,
  t: TFunction,
): string {
  if (!borrower) return ''
  if (borrower.anonymized_at) return t('borrowers.anonymized_label')
  return borrower.name
}
