import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useNavigate } from 'react-router-dom'

import { deleteAccount, exportBooksCsv, exportUserData, formatApiError, purgeLibrary } from '../lib/api'
import { ImportCsvModal } from '../components/ImportCsvModal'
import { Modal } from '../components/Modal'
import { useEnrichAll } from '../hooks/useEnrich'
import { useBillingStatus, useCreateCheckout, useCreatePortal } from '../hooks/useBilling'
import { useAddMember, useCreateLibrary, useLibraries, useLibraryMembers, useRemoveMember, useUpdateLibrary, useUpdateMember } from '../hooks/useLibrary'
import { useToggleWishlist } from '../hooks/useWishlist'
import { useResetOnboarding } from '../hooks/useOnboarding'
import { useToastStore } from '../lib/toast-store'
import { disableAnalytics, initAnalytics, trackEvent } from '../lib/analytics'
import { getConsent, setConsent } from '../lib/consent'
import type { LibraryRole } from '../lib/types'
import { ROUTES } from '../lib/routes'
import { useAuth } from '../contexts/AuthContext'
import { setLanguage } from '../i18n'
import { useSettingsStore } from '../store/useSettingsStore'
import { useLibraryStore } from '../store/useLibraryStore'

// ── Helpers ────────────────────────────────────────────────────────────────

function roleLabel(role: LibraryRole, t: (key: string) => string): string {
  if (role === 'owner') return t('library.role_owner')
  if (role === 'editor') return t('library.role_editor')
  return t('library.role_viewer')
}

function extractStatusCode(error: unknown): number | null {
  if (
    error &&
    typeof error === 'object' &&
    'response' in error &&
    error.response &&
    typeof error.response === 'object' &&
    'status' in error.response
  ) {
    return error.response.status as number
  }
  return null
}

// ── LibraryManagement sub-component ───────────────────────────────────────

function LibraryManagement() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const showSuccess = useToastStore((s) => s.showSuccess)
  const showError = useToastStore((s) => s.showError)
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; email: string } | null>(null)

  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId)
  const setActiveLibraryId = useLibraryStore((s) => s.setActiveLibraryId)

  const { data: libraries, isLoading: libLoading, isError: libError } = useLibraries()

  // Auto-select first valid library when missing or stale.
  useEffect(() => {
    if (!libraries || libraries.length === 0) return
    const activeStillValid = activeLibraryId ? libraries.some((l) => l.id === activeLibraryId) : false
    if (!activeStillValid) {
      setActiveLibraryId(libraries[0].id)
    }
  }, [activeLibraryId, libraries, setActiveLibraryId])

  const activeLibrary = libraries?.find((l) => l.id === activeLibraryId) ?? null
  const isOwner = activeLibrary?.role === 'owner'

  const { data: members, isLoading: membersLoading, isError: membersError } = useLibraryMembers(activeLibraryId)

  const addMemberMutation = useAddMember(activeLibraryId ?? '')
  const updateMemberMutation = useUpdateMember(activeLibraryId ?? '')
  const removeMemberMutation = useRemoveMember(activeLibraryId ?? '')
  const toggleWishlistMutation = useToggleWishlist(activeLibraryId ?? '')
  const updateLibraryMutation = useUpdateLibrary(activeLibraryId ?? '')

  /* Rename form state — seeded from the active library, reset on switch. */
  const [libraryName, setLibraryName] = useState('')
  useEffect(() => {
    setLibraryName(activeLibrary?.name ?? '')
  }, [activeLibrary?.id, activeLibrary?.name])

  function handleRenameLibrary(e: FormEvent) {
    e.preventDefault()
    const name = libraryName.trim()
    if (!name || name === activeLibrary?.name) return
    updateLibraryMutation.mutate(
      { name },
      {
        onSuccess: () => showSuccess(t('library.rename_success')),
        onError: (err) => showError(formatApiError(err) || t('library.rename_error')),
      },
    )
  }

  function handleWishlistToggle(enabled: boolean) {
    toggleWishlistMutation.mutate(
      { wishlist_enabled: enabled },
      {
        onSuccess: () => showSuccess(t('library.wishlist_toggle_success')),
        onError: (err) => showError(formatApiError(err) || t('library.wishlist_toggle_error')),
      },
    )
  }

  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<LibraryRole>('viewer')

  /* Create-library form. The backend enforces the per-plan library limit
     (free/home 1, pro 3, library 10) — the client doesn't duplicate the
     numbers, it just translates the 403 into an upgrade hint. */
  const createLibraryMutation = useCreateLibrary()
  const [createOpen, setCreateOpen] = useState(false)
  const [newLibraryName, setNewLibraryName] = useState('')

  function handleCreateLibrary(e: FormEvent) {
    e.preventDefault()
    const name = newLibraryName.trim()
    if (!name) return
    createLibraryMutation.mutate(
      { name },
      {
        onSuccess: (library) => {
          setNewLibraryName('')
          setCreateOpen(false)
          // Jump straight into the new library — matches the invite flow.
          setActiveLibraryId(library.id)
          showSuccess(t('library.create_success'))
        },
        onError: (err) => {
          const status = extractStatusCode(err)
          if (status === 403) showError(t('library.create_error_403'))
          else showError(formatApiError(err) || t('library.create_error'))
        },
      },
    )
  }

  function handleAddMember(e: FormEvent) {
    e.preventDefault()
    if (!newEmail.trim()) return
    addMemberMutation.mutate(
      { email: newEmail.trim(), role: newRole },
      {
        onSuccess: () => {
          setNewEmail('')
          setNewRole('viewer')
          showSuccess(t('library.add_success'))
        },
        onError: (err) => {
          const status = extractStatusCode(err)
          if (status === 403) showError(t('library.add_error_403'))
          else if (status === 404) showError(t('library.add_error_404'))
          else showError(formatApiError(err) || t('library.add_error'))
        },
      },
    )
  }

  function handleRoleChange(userId: string, role: LibraryRole) {
    updateMemberMutation.mutate(
      { userId, role },
      {
        onSuccess: () => showSuccess(t('library.role_update_success')),
        onError: (err) => {
          const status = extractStatusCode(err)
          if (status === 400) showError(t('library.role_update_error_400'))
          else showError(formatApiError(err) || t('library.role_update_error'))
        },
      },
    )
  }

  function handleRemove(userId: string, email: string) {
    setConfirmRemove({ userId, email })
  }

  function confirmRemoveMember() {
    if (!confirmRemove) return
    removeMemberMutation.mutate(confirmRemove.userId, {
      onSuccess: () => { setConfirmRemove(null); showSuccess(t('library.remove_success')) },
      onError: (err) => {
        setConfirmRemove(null)
        const status = extractStatusCode(err)
        if (status === 400) showError(t('library.remove_error_400'))
        else showError(formatApiError(err) || t('library.remove_error'))
      },
    })
  }

  return (
    <div className='stg-section' data-testid='section-library'>
      <h3 className='stg-section-title'>{t('library.title')}</h3>
      <p className='stg-row-desc' style={{ marginBottom: 12 }}>{t('library.description')}</p>

      {/* Library selector */}
      {libLoading && <p className='stg-row-desc'>{t('library.loading')}</p>}
      {libError && <p className='stg-row-desc' style={{ color: 'var(--sh-red)' }}>{t('library.error')}</p>}
      {libraries && libraries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {libraries.map((lib) => {
            const active = lib.id === activeLibraryId
            return (
              <div
                key={lib.id}
                aria-label={`library-${lib.id}`}
                className={`stg-lib-row${active ? ' stg-lib-row--active' : ''}`}
              >
                <span className='stg-lib-name' style={{ fontWeight: active ? 600 : 400 }}>
                  {lib.name}
                  <span className='stg-role-badge' style={{ marginLeft: 8 }}>
                    {roleLabel(lib.role, t)}
                  </span>
                </span>
                {!active && (
                  <button
                    type='button'
                    className='sh-btn-secondary'
                    style={{ fontSize: 12, padding: '4px 12px' }}
                    onClick={() => setActiveLibraryId(lib.id)}
                  >
                    {t('library.switch')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create a new library — account-level, gated by the plan limit on
          the backend. */}
      <div style={{ marginTop: 12 }}>
        {!createOpen ? (
          <button
            type='button'
            className='sh-btn-secondary'
            data-testid='create-library-button'
            style={{ fontSize: 13 }}
            onClick={() => setCreateOpen(true)}
          >
            {t('library.create_button')}
          </button>
        ) : (
          <form
            onSubmit={handleCreateLibrary}
            aria-label='create-library-form'
            data-testid='create-library-form'
            className='stg-add-form'
          >
            <div className='stg-add-form-field'>
              <label>{t('library.create_name_label')}</label>
              <input
                className='sh-input'
                placeholder={t('library.create_name_placeholder')}
                value={newLibraryName}
                onChange={(e) => setNewLibraryName(e.target.value)}
                aria-label='new-library-name'
                maxLength={200}
                required
              />
            </div>
            <button
              type='submit'
              className='sh-btn-primary'
              data-testid='create-library-submit'
              disabled={createLibraryMutation.isPending || !newLibraryName.trim()}
              style={{ height: 38, alignSelf: 'flex-end' }}
            >
              {createLibraryMutation.isPending ? t('library.creating') : t('library.create_submit')}
            </button>
            <button
              type='button'
              className='sh-btn-secondary'
              onClick={() => { setCreateOpen(false); setNewLibraryName('') }}
              style={{ height: 38, alignSelf: 'flex-end' }}
            >
              {t('common.cancel')}
            </button>
          </form>
        )}
      </div>

      {/* Rename — owners only; the name shows in the books-page header. */}
      {activeLibrary && isOwner && (
        <form
          onSubmit={handleRenameLibrary}
          className='stg-row'
          data-testid='library-rename-row'
          style={{ marginTop: 16 }}
        >
          <div className='stg-row-label'>
            <p className='stg-row-title'>{t('library.rename_title')}</p>
            <p className='stg-row-desc'>{t('library.rename_desc')}</p>
          </div>
          <div className='stg-row-control' style={{ display: 'flex', gap: 8 }}>
            <input
              className='sh-input'
              value={libraryName}
              onChange={(e) => setLibraryName(e.target.value)}
              aria-label='library-name'
              maxLength={200}
              required
              style={{ minWidth: 180 }}
            />
            <button
              type='submit'
              className='sh-btn-primary'
              disabled={
                updateLibraryMutation.isPending
                || !libraryName.trim()
                || libraryName.trim() === activeLibrary.name
              }
              style={{ height: 38 }}
            >
              {updateLibraryMutation.isPending ? t('library.renaming') : t('library.rename_save')}
            </button>
          </div>
        </form>
      )}

      {/* Wishlist toggle (#309) — owners only; viewers/editors just follow
          the flag via the nav item. */}
      {activeLibrary && isOwner && (
        <div className='stg-row' data-testid='wishlist-toggle-row' style={{ marginTop: 16 }}>
          <div className='stg-row-label'>
            <p className='stg-row-title'>{t('library.wishlist_toggle_title')}</p>
            <p className='stg-row-desc'>{t('library.wishlist_toggle_desc')}</p>
          </div>
          <div className='stg-row-control'>
            <label className='stg-toggle' aria-label='wishlist-toggle'>
              <input
                type='checkbox'
                checked={activeLibrary.wishlist_enabled}
                disabled={toggleWishlistMutation.isPending}
                onChange={(e) => handleWishlistToggle(e.target.checked)}
              />
              <span className='stg-toggle-track' />
            </label>
          </div>
        </div>
      )}

      {/* Members */}
      {activeLibraryId && (
        <div style={{ marginTop: 20 }}>
          <h4 className='stg-row-title' style={{ marginBottom: 8 }}>
            {t('library.members_title')}
          </h4>

          {membersLoading && <p className='stg-row-desc'>{t('library.members_loading')}</p>}
          {membersError && (
            <p className='stg-row-desc' style={{ color: 'var(--sh-red)' }}>
              {t('library.members_error')}
            </p>
          )}

          {members && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {members.map((m) => {
                const isCurrentUser = m.user_id === user?.id
                return (
                  <div key={m.user_id} aria-label={`member-${m.user_id}`} className='stg-member-row'>
                    <span className='stg-member-email'>
                      {m.email}
                      {isCurrentUser && (
                        <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--sh-text-muted)' }}>
                          {t('library.you')}
                        </span>
                      )}
                    </span>

                    {isOwner ? (
                      <div className='stg-member-controls'>
                        <select
                          aria-label={`role-select-${m.user_id}`}
                          value={m.role}
                          onChange={(e) => handleRoleChange(m.user_id, e.target.value as LibraryRole)}
                          disabled={updateMemberMutation.isPending}
                          style={{ fontSize: 13 }}
                        >
                          <option value='owner'>{t('library.role_owner')}</option>
                          <option value='editor'>{t('library.role_editor')}</option>
                          <option value='viewer'>{t('library.role_viewer')}</option>
                        </select>
                        <button
                          type='button'
                          aria-label={`remove-${m.user_id}`}
                          className='sh-btn-secondary'
                          style={{ fontSize: 12, padding: '3px 10px', color: 'var(--sh-red)' }}
                          disabled={removeMemberMutation.isPending}
                          onClick={() => handleRemove(m.user_id, m.email)}
                        >
                          {t('library.remove')}
                        </button>
                      </div>
                    ) : (
                      <span className='stg-role-badge'>
                        {roleLabel(m.role, t)}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Add member form — owners only */}
          {isOwner && (
            <form onSubmit={handleAddMember} aria-label='add-member-form' className='stg-add-form'>
              <div className='stg-add-form-field'>
                <label>{t('library.email_label')}</label>
                <input
                  className='sh-input'
                  type='email'
                  placeholder={t('library.email_placeholder')}
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                  aria-label='new-member-email'
                />
              </div>
              <div className='stg-add-form-field' style={{ flex: '0 0 auto' }}>
                <label>{t('library.role_label')}</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as LibraryRole)}
                  aria-label='new-member-role'
                  style={{ fontSize: 13, height: 38 }}
                >
                  <option value='viewer'>{t('library.role_viewer')}</option>
                  <option value='editor'>{t('library.role_editor')}</option>
                  <option value='owner'>{t('library.role_owner')}</option>
                </select>
              </div>
              <button
                type='submit'
                className='sh-btn-primary'
                disabled={addMemberMutation.isPending || !newEmail.trim()}
                style={{ height: 38, alignSelf: 'flex-end' }}
              >
                {addMemberMutation.isPending ? t('library.adding') : t('library.add_button')}
              </button>
            </form>
          )}
        </div>
      )}

      <Modal open={!!confirmRemove} onClose={() => setConfirmRemove(null)} label={t('library.remove_title')} size="sm">
        <h3 className="text-h3" style={{ marginTop: 0 }}>{t('library.remove_title')}</h3>
        <p className="text-p" style={{ marginBottom: 24 }}>{t('library.remove_body', { email: confirmRemove?.email ?? '' })}</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button type="button" className="sh-btn-secondary" onClick={() => setConfirmRemove(null)}>{t('common.cancel')}</button>
          <button type="button" className="sh-btn-danger" onClick={confirmRemoveMember}>{t('library.remove')}</button>
        </div>
      </Modal>
    </div>
  )
}

// ── BillingSection ────────────────────────────────────────────────────────

const PLAN_LABELS: Record<string, string> = { free: 'Free', home: 'Home', pro: 'Pro', library: 'Library' }

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100))
  const isWarning = limit > 0 && pct >= 80
  const isOver = limit > 0 && used >= limit
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13 }}>{label}</span>
        <span style={{ fontSize: 13, color: isOver ? 'var(--sh-red)' : 'var(--sh-text-muted)', fontWeight: isOver ? 600 : 400 }}>
          {limit === -1 ? `${used} / \u221E` : `${used} / ${limit}`}
        </span>
      </div>
      {limit !== -1 && (
        <div style={{ height: 6, borderRadius: 3, background: 'var(--sh-border)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: isOver ? 'var(--sh-red)' : isWarning ? '#f59e0b' : 'var(--sh-primary)', transition: 'width 0.3s' }} />
        </div>
      )}
    </div>
  )
}

function BillingSection() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // Gate on auth — SettingsPage is inside ProtectedRoute today, but this query
  // is also mounted by sub-sections and we want the cache to stay clean across
  // auth boundaries (see #125).
  const { isAuthenticated } = useAuth()
  const { data: billing, isLoading } = useBillingStatus({ enabled: isAuthenticated })
  const checkoutMutation = useCreateCheckout()
  const portalMutation = useCreatePortal()
  const showSuccess = useToastStore((s) => s.showSuccess)
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  // Handle return from Stripe Checkout success URL.
  //
  // Stripe redirects to ``/settings#billing-success`` (hash fragment, not
  // query string — see backend ``success_url`` rationale). Legacy
  // ``?billing_success=1`` is still handled in case any cached checkout
  // session from before the switch fires after deploy.
  useEffect(() => {
    const hasQuerySignal = searchParams.get('billing_success') !== null
    const hasHashSignal = window.location.hash === '#billing-success'
    if (!hasQuerySignal && !hasHashSignal) return

    showSuccess(t('billing.checkout_success'))
    void queryClient.invalidateQueries({ queryKey: ['billing-status'] })
    trackEvent('billing_success')
    if (hasQuerySignal) setSearchParams({})
    if (hasHashSignal) {
      // Strip the hash without adding a new history entry.
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !billing) {
    return (
      <div className='stg-section' data-testid='section-billing'>
        <h3 className='stg-section-title'>{t('billing.section_title')}</h3>
        <p className='stg-row-desc'>{t('billing.loading')}</p>
      </div>
    )
  }

  const planLabel = PLAN_LABELS[billing.plan] ?? billing.plan
  const isFree = billing.plan === 'free'

  return (
    <div className='stg-section' data-testid='section-billing'>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 className='stg-section-title' style={{ margin: 0 }}>{t('billing.section_title')}</h3>
        <span style={{
          fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
          padding: '3px 10px', borderRadius: 'var(--sh-radius-pill)',
          background: isFree ? 'var(--sh-border)' : 'var(--sh-primary)',
          color: isFree ? 'var(--sh-text-muted)' : 'white',
        }}>
          {planLabel}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        <UsageMeter
          label={t('billing.usage_scans')}
          used={billing.usage.scans_used}
          limit={billing.usage.scans_limit}
        />
        <UsageMeter
          label={t('billing.usage_enrichments')}
          used={billing.usage.enrichments_used}
          limit={billing.usage.enrichments_limit}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {isFree ? (
          <>
            <button
              type='button'
              className='sh-btn-primary'
              onClick={() => {
                // Settings-page upgrade shortcut goes straight to Pro monthly.
                // Users who want Home/yearly/library go through "See all plans"
                // → PricingPage which exposes the interval toggle + full tier grid.
                trackEvent('upgrade_clicked', { plan: 'pro', source: 'settings', interval: 'monthly' })
                checkoutMutation.mutate({ plan: 'pro', interval: 'monthly' })
              }}
              disabled={checkoutMutation.isPending}
              style={{ fontSize: 13 }}
            >
              {checkoutMutation.isPending ? t('billing.redirecting') : t('billing.upgrade_to_pro')}
            </button>
            <button
              type='button'
              className='sh-btn-secondary'
              onClick={() => navigate(ROUTES.pricing)}
              style={{ fontSize: 13 }}
            >
              {t('billing.see_all_plans')}
            </button>
          </>
        ) : (
          <button
            type='button'
            className='sh-btn-secondary'
            onClick={() => portalMutation.mutate()}
            disabled={portalMutation.isPending}
            style={{ fontSize: 13 }}
          >
            {portalMutation.isPending ? '\u2026' : t('billing.manage_subscription')}
          </button>
        )}
      </div>

      {billing.current_period_end && !isFree && (
        <p className='stg-row-desc' style={{ marginTop: 10, marginBottom: 0 }}>
          {t('billing.renews_on', { date: new Date(billing.current_period_end).toLocaleDateString() })}
        </p>
      )}
    </div>
  )
}

// ── SettingsPage ───────────────────────────────────────────────────────────

export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const darkMode = useSettingsStore((s) => s.darkMode)
  const setDarkMode = useSettingsStore((s) => s.setDarkMode)
  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)
  const { user, logout } = useAuth()
  const enrichAllMutation = useEnrichAll()
  const resetOnboardingMutation = useResetOnboarding()
  const queryClient = useQueryClient()
  const currentLang = i18n.language === 'en' ? 'en' : 'cs'

  // ── Danger zone state ──
  const [purgePassword, setPurgePassword] = useState('')
  const [purgeDeleteConfirm, setPurgeDeleteConfirm] = useState('')
  const [purging, setPurging] = useState(false)
  const [deleteAccountExpanded, setDeleteAccountExpanded] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)

  // ── Export state ──
  const [exportingData, setExportingData] = useState(false)
  const [exportingCsv, setExportingCsv] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [analyticsConsent, setAnalyticsConsent] = useState(() => getConsent() === 'granted')

  function toggleAnalyticsConsent() {
    if (analyticsConsent) {
      setConsent('denied')
      disableAnalytics()
      setAnalyticsConsent(false)
    } else {
      setConsent('granted')
      void initAnalytics()
      setAnalyticsConsent(true)
    }
  }

  const isOAuthOnly = user?.has_local_password === false

  return (
    <section className='stg-page'>
      <h2 className='text-h2'>{t('settings.title')}</h2>

      {/* ── Preferences ── */}
      <div className='stg-section' data-testid='section-preferences'>
        <h3 className='stg-section-title'>{t('settings.preferences_title')}</h3>

        <div className='stg-row'>
          <div className='stg-row-label'>
            <p className='stg-row-title'>{t('settings.dark_mode_title')}</p>
            <p className='stg-row-desc'>{t('settings.dark_mode_description')}</p>
          </div>
          <div className='stg-row-control'>
            <label className='stg-toggle' aria-label='dark-mode-toggle'>
              <input
                type='checkbox'
                checked={darkMode}
                onChange={(e) => setDarkMode(e.target.checked)}
              />
              <span className='stg-toggle-track' />
            </label>
          </div>
        </div>

        <div className='stg-row'>
          <div className='stg-row-label'>
            <p className='stg-row-title'>{t('settings.language_title')}</p>
          </div>
          <div className='stg-row-control'>
            <div className='stg-lang-group' role='radiogroup' aria-label={t('settings.language_title')}>
              <button
                type='button'
                role='radio'
                aria-checked={currentLang === 'cs'}
                className={`stg-lang-btn${currentLang === 'cs' ? ' stg-lang-btn--active' : ''}`}
                onClick={() => setLanguage('cs')}
              >
                {t('settings.language_cs')}
              </button>
              <button
                type='button'
                role='radio'
                aria-checked={currentLang === 'en'}
                className={`stg-lang-btn${currentLang === 'en' ? ' stg-lang-btn--active' : ''}`}
                onClick={() => setLanguage('en')}
              >
                {t('settings.language_en')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Account ── */}
      <div className='stg-section' data-testid='section-account'>
        <h3 className='stg-section-title'>{t('settings.profile_title')}</h3>
        <div className='stg-row'>
          <div className='stg-row-label'>
            <p className='stg-row-title'>{t('settings.profile_email')}</p>
            <p className='stg-row-value'>{user?.email ?? '-'}</p>
          </div>
          <div className='stg-row-control'>
            <button type='button' className='sh-btn-secondary' onClick={logout}>
              {t('nav.logout')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Library management ── */}
      <LibraryManagement />

      {/* ── Billing & plan ── */}
      <BillingSection />

      {/* ── Data & export ── */}
      <div className='stg-section' data-testid='section-data'>
        <h3 className='stg-section-title'>{t('settings.data_title')}</h3>

        {/* CSV export / import */}
        <div className='stg-row'>
          <div className='stg-row-label'>
            <p className='stg-row-title'>{t('settings.export_title')}</p>
            <p className='stg-row-desc'>{t('settings.export_description')}</p>
          </div>
          <div className='stg-row-control'>
            <button
              type='button'
              className='sh-btn-secondary'
              style={{ fontSize: 13 }}
              disabled={exportingCsv}
              onClick={async () => {
                try {
                  setExportingCsv(true)
                  const blob = await exportBooksCsv()
                  const url = URL.createObjectURL(blob)
                  const link = document.createElement('a')
                  link.href = url
                  link.download = 'shelfy-export.csv'
                  link.click()
                  URL.revokeObjectURL(url)
                  showSuccess(t('csv.export_success'))
                } catch {
                  showError(t('settings.export_error'))
                } finally {
                  setExportingCsv(false)
                }
              }}
            >
              {exportingCsv ? t('csv.exporting') : t('settings.export_button')}
            </button>
            <button
              type='button'
              className='sh-btn-secondary'
              style={{ fontSize: 13 }}
              onClick={() => setShowImportModal(true)}
              data-testid='open-import-modal-btn'
            >
              {t('csv.import_button')}
            </button>
          </div>
        </div>

        {/* Metadata enrichment */}
        <div className='stg-row'>
          <div className='stg-row-label'>
            <p className='stg-row-title'>{t('settings.enrich_title')}</p>
            <p className='stg-row-desc'>{t('settings.enrich_description')}</p>
          </div>
          <div className='stg-row-control'>
            <button
              type='button'
              className='sh-btn-secondary'
              style={{ fontSize: 13 }}
              disabled={enrichAllMutation.isPending}
              onClick={() => enrichAllMutation.mutate({ force: false })}
            >
              {enrichAllMutation.isPending ? t('enrich.enriching') : t('enrich.enrich_missing')}
            </button>
            <button
              type='button'
              className='sh-btn-secondary'
              style={{ fontSize: 12 }}
              disabled={enrichAllMutation.isPending}
              onClick={() => enrichAllMutation.mutate({ force: true })}
            >
              {t('enrich.force_reindex')}
            </button>
          </div>
        </div>

        {/* GDPR data export */}
        <div className='stg-row'>
          <div className='stg-row-label'>
            <p className='stg-row-title'>{t('settings.export_data_title')}</p>
            <p className='stg-row-desc'>{t('settings.export_data_description')}</p>
          </div>
          <div className='stg-row-control'>
            <button
              type='button'
              className='sh-btn-secondary'
              style={{ fontSize: 13 }}
              disabled={exportingData}
              onClick={async () => {
                try {
                  setExportingData(true)
                  const blob = await exportUserData()
                  const url = URL.createObjectURL(blob)
                  const link = document.createElement('a')
                  link.href = url
                  link.download = 'shelfy-export.json'
                  link.click()
                  URL.revokeObjectURL(url)
                } catch {
                  showError(t('settings.export_error'))
                } finally {
                  setExportingData(false)
                }
              }}
            >
              {exportingData ? t('settings.export_data_exporting') : t('settings.export_data_button')}
            </button>
          </div>
        </div>
      </div>

      <ImportCsvModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={() => {
          setShowImportModal(false)
          showSuccess(t('csv.import_success'))
          queryClient.invalidateQueries({ queryKey: ['books'] })
        }}
      />

      {/* ── About & legal ── */}
      <div className='stg-section' data-testid='section-about'>
        <h3 className='stg-section-title'>{t('settings.about_title')}</h3>

        <div className='stg-row'>
          <div className='stg-row-label'>
            <p className='stg-row-title'>{t('onboarding.settings_reset_title')}</p>
            <p className='stg-row-desc'>{t('onboarding.settings_reset_desc')}</p>
          </div>
          <div className='stg-row-control'>
            <button
              type='button'
              className='sh-btn-secondary'
              style={{ fontSize: 13 }}
              disabled={resetOnboardingMutation.isPending}
              onClick={() => {
                resetOnboardingMutation.mutate(undefined, {
                  onSuccess: () => {
                    localStorage.removeItem('shelfy_onboarding_dismissed')
                    showSuccess(t('onboarding.reset_done'))
                  },
                })
              }}
            >
              {t('onboarding.settings_reset')}
            </button>
          </div>
        </div>

        <div className='stg-row'>
          <div className='stg-row-label'>
            <p className='stg-row-title'>{t('consent.settings_title')}</p>
            <p className='stg-row-desc'>{t('consent.settings_description')}</p>
          </div>
          <div className='stg-row-control' style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className='stg-row-desc' style={{ margin: 0 }}>
              {analyticsConsent ? t('consent.status_granted') : t('consent.status_denied')}
            </span>
            <button
              type='button'
              className='sh-btn-secondary'
              style={{ fontSize: 13 }}
              onClick={toggleAnalyticsConsent}
              data-testid='toggle-analytics-consent'
            >
              {analyticsConsent ? t('consent.disable') : t('consent.enable')}
            </button>
          </div>
        </div>

        <div className='stg-row'>
          <div className='stg-row-label'>
            <p className='stg-row-title'>{t('settings.legal_title')}</p>
            <p className='stg-row-desc'>{t('settings.legal_description')}</p>
          </div>
          <div className='stg-row-control'>
            <a
              className='sh-btn-secondary'
              href={ROUTES.privacy}
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', fontSize: 13 }}
            >
              {t('settings.privacy_link')}
            </a>
            <a
              className='sh-btn-secondary'
              href={ROUTES.terms}
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', fontSize: 13 }}
            >
              {t('settings.terms_link')}
            </a>
          </div>
        </div>
      </div>

      {/* ── Danger zone ── */}
      <div className='stg-section stg-danger' data-testid='section-danger'>
        <h3 className='stg-section-title'>{t('settings.danger_title')}</h3>
        <p className='stg-danger-desc'>{t('settings.danger_description')}</p>

        <div className='stg-confirm-grid'>
          {isOAuthOnly ? (
            <>
              <input
                className='sh-input'
                type='text'
                placeholder={t('settings.type_delete_to_confirm')}
                value={purgeDeleteConfirm}
                onChange={(e) => setPurgeDeleteConfirm(e.target.value)}
              />
              <button
                type='button'
                className='sh-btn-danger'
                disabled={purging || purgeDeleteConfirm.trim().toUpperCase() !== 'DELETE'}
                onClick={async () => {
                  try {
                    setPurging(true)
                    const res = await purgeLibrary('')
                    setPurgeDeleteConfirm('')
                    alert(t('settings.purge_success', { books: res.deleted_books, locations: res.deleted_locations }))
                  } catch (e) {
                    showError((e as Error)?.message || t('settings.purge_error'))
                  } finally {
                    setPurging(false)
                  }
                }}
              >
                {purging ? t('settings.purging') : t('settings.purge_button')}
              </button>
            </>
          ) : (
            <>
              <input
                className='sh-input'
                type='password'
                placeholder={t('settings.confirm_password')}
                value={purgePassword}
                onChange={(e) => setPurgePassword(e.target.value)}
              />
              <button
                type='button'
                className='sh-btn-danger'
                disabled={purging || !purgePassword.trim()}
                onClick={async () => {
                  try {
                    setPurging(true)
                    const res = await purgeLibrary(purgePassword.trim())
                    setPurgePassword('')
                    alert(t('settings.purge_success', { books: res.deleted_books, locations: res.deleted_locations }))
                  } catch (e) {
                    showError((e as Error)?.message || t('settings.purge_error'))
                  } finally {
                    setPurging(false)
                  }
                }}
              >
                {purging ? t('settings.purging') : t('settings.purge_button')}
              </button>
            </>
          )}
        </div>

        {/* Delete account */}
        <div className='stg-danger-sub'>
          <p className='stg-danger-sub-title'>{t('settings.delete_account_title')}</p>
          <p className='stg-danger-desc'>{t('settings.delete_account_description')}</p>

          {!deleteAccountExpanded ? (
            <button
              type='button'
              className='sh-btn-danger'
              onClick={() => setDeleteAccountExpanded(true)}
            >
              {t('settings.delete_account_button')}
            </button>
          ) : (
            <div className='stg-confirm-grid'>
              {isOAuthOnly ? (
                <input
                  className='sh-input'
                  type='text'
                  placeholder={t('settings.type_delete_to_confirm')}
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  autoFocus
                />
              ) : (
                <input
                  className='sh-input'
                  type='password'
                  placeholder={t('settings.confirm_password')}
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  autoFocus
                />
              )}
              <div className='stg-confirm-actions'>
                <button
                  type='button'
                  className='sh-btn-danger'
                  disabled={
                    deletingAccount ||
                    (isOAuthOnly
                      ? deleteConfirmText.trim().toUpperCase() !== 'DELETE'
                      : !deletePassword.trim())
                  }
                  onClick={async () => {
                    try {
                      setDeletingAccount(true)
                      await deleteAccount(isOAuthOnly ? '' : deletePassword.trim())
                      logout()
                    } catch {
                      showError(t('settings.delete_account_error'))
                      setDeletingAccount(false)
                    }
                  }}
                >
                  {deletingAccount ? t('settings.delete_account_deleting') : t('settings.delete_account_confirm')}
                </button>
                <button
                  type='button'
                  className='sh-btn-secondary'
                  disabled={deletingAccount}
                  onClick={() => { setDeleteAccountExpanded(false); setDeletePassword(''); setDeleteConfirmText('') }}
                >
                  {t('settings.delete_account_cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
