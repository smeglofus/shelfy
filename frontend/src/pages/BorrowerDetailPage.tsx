import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { EmptyShelfIcon, NoResultsIcon } from '../components/EmptyStateIcons'
import { useBorrower, useBorrowerLoans } from '../hooks/useBorrowers'
import { ROUTES, getBookDetailRoute } from '../lib/routes'
import type { BorrowerLoanItem } from '../lib/types'

function formatDate(value: string | null, locale: string): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString(locale)
  } catch {
    return value
  }
}

interface LoanRowProps {
  loan: BorrowerLoanItem
  locale: string
}

function LoanRow({ loan, locale }: LoanRowProps) {
  const { t } = useTranslation()
  return (
    <li
      data-testid={`borrower-loan-${loan.id}`}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 12,
        padding: 12,
        border: '1px solid var(--sh-border)',
        borderRadius: 'var(--sh-radius-md)',
        background: 'var(--sh-surface)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <Link
          to={getBookDetailRoute(loan.book_id)}
          style={{ fontWeight: 600, color: 'inherit', textDecoration: 'none' }}
        >
          {loan.book_title}
        </Link>
        {loan.book_author && (
          <div style={{ fontSize: 13, color: 'var(--sh-text-muted)' }}>{loan.book_author}</div>
        )}
        {loan.notes && (
          <div style={{ fontSize: 12, color: 'var(--sh-text-muted)', marginTop: 4 }}>{loan.notes}</div>
        )}
      </div>
      <div
        style={{
          display: 'grid',
          gap: 2,
          fontSize: 12,
          color: 'var(--sh-text-muted)',
          textAlign: 'right',
          whiteSpace: 'nowrap',
        }}
      >
        <span>{t('loans.lent_date')}: {formatDate(loan.lent_date, locale)}</span>
        {loan.due_date && <span>{t('loans.due_date')}: {formatDate(loan.due_date, locale)}</span>}
        {loan.returned_date && (
          <span>
            {t('loans.return_date')}: {formatDate(loan.returned_date, locale)}
          </span>
        )}
        {loan.return_condition && (
          <span data-testid={`borrower-loan-condition-${loan.id}`}>
            {t(`loans.condition_${loan.return_condition}`)}
          </span>
        )}
      </div>
    </li>
  )
}

export function BorrowerDetailPage() {
  const { borrowerId } = useParams<{ borrowerId: string }>()
  const { t, i18n } = useTranslation()
  const borrowerQuery = useBorrower(borrowerId ?? '')
  const loansQuery = useBorrowerLoans(borrowerId ?? '')

  const { active, returned } = useMemo(() => {
    const all = loansQuery.data ?? []
    return {
      active: all.filter((l) => l.returned_date === null),
      returned: all.filter((l) => l.returned_date !== null),
    }
  }, [loansQuery.data])

  if (borrowerQuery.isLoading) {
    return (
      <main className="sh-main" style={{ padding: 24, maxWidth: 760, margin: '0 auto' }}>
        <p data-testid="borrower-detail-loading" style={{ color: 'var(--sh-text-muted)' }}>
          {t('borrowers.loading')}
        </p>
      </main>
    )
  }

  if (borrowerQuery.isError || !borrowerQuery.data) {
    return (
      <main className="sh-main" style={{ padding: 24, maxWidth: 760, margin: '0 auto' }}>
        <p data-testid="borrower-detail-error" style={{ color: 'var(--sh-text-muted)' }}>
          {t('borrowers.detail_not_found')}
        </p>
        <Link to={ROUTES.borrowers}>{t('borrowers.back_to_overview')}</Link>
      </main>
    )
  }

  const borrower = borrowerQuery.data

  return (
    <main className="sh-main" style={{ padding: 24, maxWidth: 760, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          to={ROUTES.borrowers}
          style={{ fontSize: 13, color: 'var(--sh-text-muted)', textDecoration: 'none' }}
        >
          ← {t('borrowers.back_to_overview')}
        </Link>
      </div>

      <header style={{ marginBottom: 24 }}>
        <h1 className="text-h2" style={{ margin: 0 }}>{borrower.name}</h1>
        {borrower.contact && (
          <p style={{ margin: '4px 0 0', color: 'var(--sh-text-muted)' }}>{borrower.contact}</p>
        )}
        {borrower.notes && (
          <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{borrower.notes}</p>
        )}
      </header>

      {/* Active loans */}
      <section style={{ marginBottom: 24 }}>
        <h2 className="text-h3" style={{ margin: '0 0 8px' }}>
          {t('borrowers.section_active_loans')}
        </h2>
        {loansQuery.isLoading ? (
          <p data-testid="borrower-loans-loading" style={{ color: 'var(--sh-text-muted)' }}>
            {t('borrowers.loading')}
          </p>
        ) : active.length === 0 ? (
          <div
            data-testid="borrower-active-empty"
            style={{ padding: 16, color: 'var(--sh-text-muted)', textAlign: 'center' }}
          >
            <EmptyShelfIcon size={48} />
            <p style={{ margin: '8px 0 0' }}>{t('borrowers.empty_active_loans')}</p>
          </div>
        ) : (
          <ul
            data-testid="borrower-active-list"
            style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}
          >
            {active.map((loan) => (
              <LoanRow key={loan.id} loan={loan} locale={i18n.language} />
            ))}
          </ul>
        )}
      </section>

      {/* Returned loans */}
      <section>
        <h2 className="text-h3" style={{ margin: '0 0 8px' }}>
          {t('borrowers.section_returned_loans')}
        </h2>
        {loansQuery.isLoading ? null : returned.length === 0 ? (
          <div
            data-testid="borrower-returned-empty"
            style={{ padding: 16, color: 'var(--sh-text-muted)', textAlign: 'center' }}
          >
            <NoResultsIcon size={48} />
            <p style={{ margin: '8px 0 0' }}>{t('borrowers.empty_returned_loans')}</p>
          </div>
        ) : (
          <ul
            data-testid="borrower-returned-list"
            style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}
          >
            {returned.map((loan) => (
              <LoanRow key={loan.id} loan={loan} locale={i18n.language} />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
