import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { EditBorrowerModal } from '../components/EditBorrowerModal'
import { EmptyShelfIcon, NoResultsIcon } from '../components/EmptyStateIcons'
import { MergeBorrowerModal } from '../components/MergeBorrowerModal'
import { Modal } from '../components/Modal'
import { useDemoPath } from '../features/demo/demoNav'
import { useIsDemoMode } from '../features/demo/DemoContext'
import { useAnonymizeBorrower, useBorrower, useBorrowerLoans, useRestoreBorrower } from '../hooks/useBorrowers'
import { displayBorrowerName } from '../lib/borrowerDisplay'
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

/**
 * Hook for the pending-anonymization countdown (#244 PR #2).
 *
 * Re-renders every 60 s — finer than that adds nothing for a 30-day TTL
 * and would burn render cycles in the background tab. Returns ``null``
 * when the deadline has already passed (the worker will finalize on
 * its next 30-min beat fire; the UI should show "any moment now"
 * rather than a negative countdown).
 */
function usePendingCountdown(
  deadline: string | null,
): { days: number; hours: number } | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadline) return
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [deadline])

  if (!deadline) return null
  const remainingMs = new Date(deadline).getTime() - now
  if (remainingMs <= 0) return null
  const days = Math.floor(remainingMs / 86_400_000)
  const hours = Math.floor((remainingMs % 86_400_000) / 3_600_000)
  return { days, hours }
}

interface AuditFooterProps {
  /** Audit data sourced from BorrowerDetailResponse (#261). */
  createdByUserId: string | null
  createdByEmail: string | null
  createdAt: string
  anonymizedByUserId: string | null
  anonymizedByEmail: string | null
  anonymizedAt: string | null
  mergedIntoByUserId: string | null
  mergedIntoByEmail: string | null
  locale: string
}

function AuditFooter({
  createdByUserId,
  createdByEmail,
  createdAt,
  anonymizedByUserId,
  anonymizedByEmail,
  anonymizedAt,
  mergedIntoByUserId,
  mergedIntoByEmail,
  locale,
}: AuditFooterProps) {
  const { t } = useTranslation()

  // Hide entirely on legacy rows where every audit FK is NULL. Once at least
  // one column is populated, render the section with whichever lines apply.
  if (createdByUserId === null && anonymizedByUserId === null && mergedIntoByUserId === null) {
    return null
  }

  const unknown = t('borrowers.audit_actor_unknown')

  return (
    <aside
      data-testid="borrower-audit-footer"
      style={{
        marginTop: 32,
        paddingTop: 16,
        borderTop: '1px solid var(--sh-border)',
        fontSize: 12,
        color: 'var(--sh-text-muted)',
      }}
    >
      <h3
        style={{
          margin: '0 0 4px',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        {t('borrowers.audit_section_title')}
      </h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
        {createdByUserId !== null && (
          <li data-testid="audit-created-by">
            {t('borrowers.audit_created_by', {
              email: createdByEmail ?? unknown,
              date: formatDate(createdAt, locale),
            })}
          </li>
        )}
        {anonymizedByUserId !== null && anonymizedAt !== null && (
          <li data-testid="audit-anonymized-by">
            {t('borrowers.audit_anonymized_by', {
              email: anonymizedByEmail ?? unknown,
              date: formatDate(anonymizedAt, locale),
            })}
          </li>
        )}
        {mergedIntoByUserId !== null && (
          <li data-testid="audit-merged-into-by">
            {t('borrowers.audit_merged_into_by', {
              email: mergedIntoByEmail ?? unknown,
            })}
          </li>
        )}
      </ul>
    </aside>
  )
}

interface LoanRowProps {
  loan: BorrowerLoanItem
  locale: string
}

function LoanRow({ loan, locale }: LoanRowProps) {
  const { t } = useTranslation()
  const demoPath = useDemoPath()
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
          to={demoPath(getBookDetailRoute(loan.book_id))}
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
  const isDemo = useIsDemoMode()
  const demoPath = useDemoPath()
  const borrowerQuery = useBorrower(borrowerId ?? '')
  const loansQuery = useBorrowerLoans(borrowerId ?? '')
  const anonymize = useAnonymizeBorrower()
  const restore = useRestoreBorrower()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  // #244 DSAR bypass — when checked, the confirm modal sends
  // ``immediate=true`` and we get the legacy hard-wipe behaviour.
  const [anonymizeImmediate, setAnonymizeImmediate] = useState(false)
  // Hook must run unconditionally (rules of hooks) — call before any
  // early returns. ``deadline=null`` short-circuits the interval setup.
  const countdown = usePendingCountdown(
    borrowerQuery.data?.pending_anonymization_until ?? null,
  )

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
        <Link to={demoPath(ROUTES.borrowers)}>{t('borrowers.back_to_overview')}</Link>
      </main>
    )
  }

  const borrower = borrowerQuery.data
  const isAnonymized = borrower.anonymized_at !== null
  const isPending = !isAnonymized && borrower.pending_anonymization_until !== null
  const displayName = displayBorrowerName(borrower, t)

  return (
    <main className="sh-main" style={{ padding: 24, maxWidth: 760, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          to={demoPath(ROUTES.borrowers)}
          style={{ fontSize: 13, color: 'var(--sh-text-muted)', textDecoration: 'none' }}
        >
          ← {t('borrowers.back_to_overview')}
        </Link>
      </div>

      <header
        style={{
          marginBottom: 24,
          display: 'flex',
          gap: 16,
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1
            className="text-h2"
            style={{
              margin: 0,
              fontStyle: isAnonymized ? 'italic' : undefined,
              color: isAnonymized ? 'var(--sh-text-muted)' : undefined,
            }}
          >
            {displayName}
          </h1>
          {isAnonymized && (
            <p
              data-testid="borrower-anonymized-badge"
              style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--sh-text-muted)' }}
            >
              {t('borrowers.anonymized_hint')}
            </p>
          )}
          {isPending && (
            <p
              data-testid="borrower-pending-anonymize-badge"
              style={{
                margin: '4px 0 0',
                fontSize: 13,
                color: 'var(--sh-yellow-text, #92400e)',
                background: 'var(--sh-yellow-soft, #fffbe6)',
                padding: '4px 8px',
                borderRadius: 'var(--sh-radius-sm)',
                display: 'inline-block',
              }}
            >
              {t('borrowers.pending_anonymization_hint')}
              {countdown && (
                <span data-testid="borrower-pending-countdown" style={{ marginLeft: 6 }}>
                  {' · '}
                  {t('borrowers.pending_anonymization_countdown', {
                    days: countdown.days,
                    hours: countdown.hours,
                  })}
                </span>
              )}
              {!countdown && (
                <span data-testid="borrower-pending-countdown-imminent" style={{ marginLeft: 6 }}>
                  {' · '}
                  {t('borrowers.pending_anonymization_imminent')}
                </span>
              )}
            </p>
          )}
          {!isAnonymized && borrower.contact && (
            <p style={{ margin: '4px 0 0', color: 'var(--sh-text-muted)' }}>{borrower.contact}</p>
          )}
          {!isAnonymized && borrower.notes && (
            <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{borrower.notes}</p>
          )}
        </div>
        {isPending && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid="restore-button"
              className="sh-btn-secondary"
              disabled={restore.isPending}
              onClick={() => restore.mutate(borrower.id)}
            >
              {restore.isPending
                ? t('borrowers.restoring')
                : t('borrowers.restore_button')}
            </button>
          </div>
        )}
        {!isAnonymized && !isPending && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid="edit-button"
              className="sh-btn-secondary"
              onClick={() => setEditOpen(true)}
            >
              {t('borrowers.edit_button')}
            </button>
            {/* Merge & anonymize are backend/GDPR workflows — hidden in the demo. */}
            {!isDemo && (
              <>
                <button
                  type="button"
                  data-testid="merge-button"
                  className="sh-btn-secondary"
                  onClick={() => setMergeOpen(true)}
                >
                  {t('borrowers.merge_button')}
                </button>
                <button
                  type="button"
                  data-testid="anonymize-button"
                  className="sh-btn-secondary"
                  onClick={() => setConfirmOpen(true)}
                >
                  {t('borrowers.anonymize_button')}
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {editOpen && (
        <EditBorrowerModal borrower={borrower} onClose={() => setEditOpen(false)} />
      )}

      {mergeOpen && (
        <MergeBorrowerModal borrower={borrower} onClose={() => setMergeOpen(false)} />
      )}

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

      <AuditFooter
        createdByUserId={borrower.created_by_user_id}
        createdByEmail={borrower.created_by_email ?? null}
        createdAt={borrower.created_at}
        anonymizedByUserId={borrower.anonymized_by_user_id}
        anonymizedByEmail={borrower.anonymized_by_email ?? null}
        anonymizedAt={borrower.anonymized_at}
        mergedIntoByUserId={borrower.merged_into_by_user_id}
        mergedIntoByEmail={borrower.merged_into_by_email ?? null}
        locale={i18n.language}
      />

      {confirmOpen && (
        <Modal
          open
          onClose={() => setConfirmOpen(false)}
          label={t('borrowers.anonymize_confirm_title')}
          maxWidth={440}
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <h3 style={{ margin: 0 }}>{t('borrowers.anonymize_confirm_title')}</h3>
            <p style={{ margin: 0 }}>
              {/* #244 — copy reflects the new 30-day soft-delete contract.
                  The legacy "this cannot be undone" line only fires when
                  the librarian explicitly opts in to the DSAR bypass. */}
              {anonymizeImmediate
                ? t('borrowers.anonymize_confirm_body_immediate', { name: displayName })
                : t('borrowers.anonymize_confirm_body_pending', { name: displayName })}
            </p>
            <label
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                fontSize: 13,
                color: 'var(--sh-text-muted)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                data-testid="anonymize-immediate-checkbox"
                checked={anonymizeImmediate}
                onChange={(e) => setAnonymizeImmediate(e.target.checked)}
                disabled={anonymize.isPending}
              />
              <span>{t('borrowers.anonymize_immediate_label')}</span>
            </label>
            {anonymizeImmediate && (
              <p
                data-testid="anonymize-irreversible-warning"
                style={{ margin: 0, color: 'var(--sh-red)', fontWeight: 500 }}
              >
                {t('borrowers.anonymize_irreversible')}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                className="sh-btn-secondary"
                onClick={() => {
                  setConfirmOpen(false)
                  setAnonymizeImmediate(false)
                }}
                disabled={anonymize.isPending}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                data-testid="anonymize-confirm"
                className="sh-btn-primary"
                style={{ background: 'var(--sh-red)' }}
                disabled={anonymize.isPending}
                onClick={() => {
                  if (!borrower) return
                  anonymize.mutate(
                    { id: borrower.id, immediate: anonymizeImmediate },
                    {
                      onSuccess: () => {
                        setConfirmOpen(false)
                        setAnonymizeImmediate(false)
                      },
                    },
                  )
                }}
              >
                {anonymize.isPending
                  ? t('borrowers.anonymizing')
                  : t('borrowers.anonymize_confirm')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  )
}
