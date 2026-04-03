import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { exportBooksCsv, formatApiError, purgeLibrary } from '../lib/api'
import { useEnrichAll } from '../hooks/useEnrich'
import { useAddMember, useLibraries, useLibraryMembers, useRemoveMember, useUpdateMember } from '../hooks/useLibrary'
import { useResetOnboarding } from '../hooks/useOnboarding'
import { useToastStore } from '../lib/toast-store'
import type { LibraryRole } from '../lib/types'
import { useAuth } from '../contexts/AuthContext'
import { setLanguage } from '../i18n'
import { useSettingsStore } from '../store/useSettingsStore'
import { useLibraryStore } from '../store/useLibraryStore'

// ── Helpers ────────────────────────────────────────────────────────────────

const ARTICLE_STYLE: React.CSSProperties = {
  marginTop: 16,
  border: '1px solid var(--sh-border)',
  borderRadius: 'var(--sh-radius-lg)',
  padding: 16,
  background: 'var(--sh-surface)',
  boxShadow: 'var(--sh-shadow-sm)',
}

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

  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId)
  const setActiveLibraryId = useLibraryStore((s) => s.setActiveLibraryId)

  const { data: libraries, isLoading: libLoading, isError: libError } = useLibraries()

  // Auto-select first library when none is stored
  useEffect(() => {
    if (!activeLibraryId && libraries && libraries.length > 0) {
      setActiveLibraryId(libraries[0].id)
    }
  }, [activeLibraryId, libraries, setActiveLibraryId])

  const activeLibrary = libraries?.find((l) => l.id === activeLibraryId) ?? null
  const isOwner = activeLibrary?.role === 'owner'

  const { data: members, isLoading: membersLoading, isError: membersError } = useLibraryMembers(activeLibraryId)

  const addMemberMutation = useAddMember(activeLibraryId ?? '')
  const updateMemberMutation = useUpdateMember(activeLibraryId ?? '')
  const removeMemberMutation = useRemoveMember(activeLibraryId ?? '')

  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<LibraryRole>('viewer')

  function handleAddMember(e: React.FormEvent) {
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
    if (!window.confirm(t('library.remove_confirm', { email }))) return
    removeMemberMutation.mutate(userId, {
      onSuccess: () => showSuccess(t('library.remove_success')),
      onError: (err) => {
        const status = extractStatusCode(err)
        if (status === 400) showError(t('library.remove_error_400'))
        else showError(formatApiError(err) || t('library.remove_error'))
      },
    })
  }

  return (
    <article style={ARTICLE_STYLE}>
      <h3 className='text-h3' style={{ marginTop: 0, marginBottom: 6 }}>
        {t('library.title')}
      </h3>
      <p className='text-small' style={{ marginTop: 0 }}>
        {t('library.description')}
      </p>

      {/* Library selector */}
      {libLoading && <p className='text-small'>{t('library.loading')}</p>}
      {libError && <p className='text-small' style={{ color: 'var(--sh-red)' }}>{t('library.error')}</p>}
      {libraries && libraries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {libraries.map((lib) => {
            const active = lib.id === activeLibraryId
            return (
              <div
                key={lib.id}
                aria-label={`library-${lib.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderRadius: 'var(--sh-radius-md)',
                  border: active ? '2px solid var(--sh-accent)' : '1px solid var(--sh-border)',
                  background: active ? 'var(--sh-accent-subtle, var(--sh-surface))' : 'var(--sh-surface)',
                  gap: 8,
                }}
              >
                <span style={{ fontWeight: active ? 600 : 400 }}>
                  {lib.name}
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'var(--sh-border)',
                    }}
                  >
                    {roleLabel(lib.role, t)}
                  </span>
                </span>
                {!active && (
                  <button
                    type='button'
                    className='sh-btn-secondary'
                    style={{ fontSize: 12, padding: '4px 10px' }}
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

      {/* Members */}
      {activeLibraryId && (
        <div style={{ marginTop: 20 }}>
          <h4 style={{ marginTop: 0, marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
            {t('library.members_title')}
          </h4>

          {membersLoading && <p className='text-small'>{t('library.members_loading')}</p>}
          {membersError && (
            <p className='text-small' style={{ color: 'var(--sh-red)' }}>
              {t('library.members_error')}
            </p>
          )}

          {members && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {members.map((m) => {
                const isCurrentUser = m.user_id === user?.id
                return (
                  <div
                    key={m.user_id}
                    aria-label={`member-${m.user_id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      borderRadius: 'var(--sh-radius-md)',
                      border: '1px solid var(--sh-border)',
                      background: 'var(--sh-bg)',
                    }}
                  >
                    <span style={{ flex: 1, fontSize: 14 }}>
                      {m.email}
                      {isCurrentUser && (
                        <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--sh-muted)' }}>
                          {t('library.you')}
                        </span>
                      )}
                    </span>

                    {isOwner ? (
                      <>
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
                          style={{ fontSize: 12, padding: '3px 8px', color: 'var(--sh-red)' }}
                          disabled={removeMemberMutation.isPending}
                          onClick={() => handleRemove(m.user_id, m.email)}
                        >
                          {t('library.remove')}
                        </button>
                      </>
                    ) : (
                      <span
                        style={{
                          fontSize: 12,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'var(--sh-border)',
                        }}
                      >
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
            <form
              onSubmit={handleAddMember}
              aria-label='add-member-form'
              style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' }}>
                <label style={{ fontSize: 12, fontWeight: 500 }}>{t('library.email_label')}</label>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 500 }}>{t('library.role_label')}</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as LibraryRole)}
                  aria-label='new-member-role'
                  style={{ fontSize: 13, height: 36 }}
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
                style={{ height: 36 }}
              >
                {addMemberMutation.isPending ? t('library.adding') : t('library.add_button')}
              </button>
            </form>
          )}
        </div>
      )}
    </article>
  )
}

// ── SettingsPage ───────────────────────────────────────────────────────────

export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const darkMode = useSettingsStore((s) => s.darkMode)
  const setDarkMode = useSettingsStore((s) => s.setDarkMode)
  const showError = useToastStore((s) => s.showError)
  const { user, logout } = useAuth()
  const enrichAllMutation = useEnrichAll()
  const resetOnboardingMutation = useResetOnboarding()
  const showSuccess = useToastStore((s) => s.showSuccess)
  const [purgePassword, setPurgePassword] = useState('')
  const [purging, setPurging] = useState(false)
  const currentLang = i18n.language === 'en' ? 'en' : 'cs'

  return (
    <section className='container md-max-w-3xl' style={{ margin: '0 auto', width: '100%' }}>
      <h2 className='text-h2'>{t('settings.title')}</h2>

      <article
        style={{
          border: '1px solid var(--sh-border)',
          borderRadius: 'var(--sh-radius-lg)',
          padding: 16,
          background: 'var(--sh-surface)',
          boxShadow: 'var(--sh-shadow-sm)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div>
          <h3 className='text-h3' style={{ marginTop: 0, marginBottom: 6 }}>{t('settings.dark_mode_title')}</h3>
          <p className='text-small'>{t('settings.dark_mode_description')}</p>
        </div>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            aria-label='dark-mode-toggle'
            type='checkbox'
            checked={darkMode}
            onChange={(event) => setDarkMode(event.target.checked)}
          />
          <span>{darkMode ? t('settings.dark_mode_on') : t('settings.dark_mode_off')}</span>
        </label>
      </article>

      <article style={ARTICLE_STYLE}>
        <h3 className='text-h3' style={{ marginTop: 0, marginBottom: 6 }}>{t('settings.profile_title')}</h3>
        <p className='text-small' style={{ marginTop: 0 }}>{t('settings.profile_description')}</p>
        <p style={{ margin: '8px 0 0' }}><strong>{t('settings.profile_email')}:</strong> {user?.email ?? '-'}</p>
        <button type='button' className='sh-btn-secondary' style={{ marginTop: 12 }} onClick={logout}>{t('nav.logout')}</button>
      </article>

      <article
        style={{
          ...ARTICLE_STYLE,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div>
          <h3 className='text-h3' style={{ marginTop: 0, marginBottom: 6 }}>{t('settings.language_title')}</h3>
          <p className='text-small'>{t('settings.language_description')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => { setLanguage('cs') }}
            className={currentLang === 'cs' ? 'sh-btn-primary' : 'sh-btn-secondary'}
          >
            {t('settings.language_cs')}
          </button>
          <button
            onClick={() => { setLanguage('en') }}
            className={currentLang === 'en' ? 'sh-btn-primary' : 'sh-btn-secondary'}
          >
            {t('settings.language_en')}
          </button>
        </div>
      </article>

      {/* ── Library management ── */}
      <LibraryManagement />

      <article
        style={{
          ...ARTICLE_STYLE,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div>
          <h3 className='text-h3' style={{ marginTop: 0, marginBottom: 6 }}>{t('settings.export_title')}</h3>
          <p className='text-small'>{t('settings.export_description')}</p>
        </div>

        <button
          type='button'
          className='sh-btn-secondary'
          onClick={async () => {
            try {
              const blob = await exportBooksCsv()
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = 'shelfy-export.csv'
              link.click()
              URL.revokeObjectURL(url)
            } catch {
              showError(t('settings.export_error'))
            }
          }}
        >
          {t('settings.export_button')}
        </button>
      </article>

      <article
        style={{
          ...ARTICLE_STYLE,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div>
          <h3 className='text-h3' style={{ marginTop: 0, marginBottom: 6 }}>{t('settings.enrich_title')}</h3>
          <p className='text-small'>{t('settings.enrich_description')}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <button
            type='button'
            className='sh-btn-secondary'
            disabled={enrichAllMutation.isPending}
            onClick={() => enrichAllMutation.mutate({ force: false })}
          >
            {enrichAllMutation.isPending ? t('enrich.enriching') : t('enrich.enrich_missing')}
          </button>
          <button
            type='button'
            className='sh-btn-secondary'
            disabled={enrichAllMutation.isPending}
            onClick={() => enrichAllMutation.mutate({ force: true })}
            style={{ fontSize: 12 }}
          >
            {t('enrich.force_reindex')}
          </button>
        </div>
      </article>

      <article
        style={{
          ...ARTICLE_STYLE,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div>
          <h3 className='text-h3' style={{ marginTop: 0, marginBottom: 6 }}>{t('onboarding.settings_reset_title')}</h3>
          <p className='text-small'>{t('onboarding.settings_reset_desc')}</p>
        </div>
        <button
          type='button'
          className='sh-btn-secondary'
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
      </article>

      <article
        style={{
          ...ARTICLE_STYLE,
          border: '1px solid rgba(220, 38, 38, 0.35)',
        }}
      >
        <h3 className='text-h3' style={{ marginTop: 0, marginBottom: 6, color: 'var(--sh-red)' }}>{t('settings.danger_title')}</h3>
        <p className='text-small' style={{ marginTop: 0 }}>{t('settings.danger_description')}</p>
        <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
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
        </div>
      </article>
    </section>
  )
}
