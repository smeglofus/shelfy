/**
 * Analytics consent — single source of truth for whether the user has opted
 * in to non-essential product analytics (PostHog + Session Replay).
 *
 * Under ePrivacy (CZ §89 zák. 127/2005 Sb.) storing/accessing non-essential
 * data on the user's device — including localStorage, not just cookies —
 * requires opt-in consent. Strictly-necessary storage (auth/session, CSRF)
 * does NOT, and is never gated by this module.
 *
 * State is persisted in localStorage:
 *   'granted' — user opted in; analytics may run.
 *   'denied'  — user opted out; analytics must stay off.
 *   null      — no choice yet; show the consent banner, analytics stays off.
 */

export type ConsentState = 'granted' | 'denied'

const STORAGE_KEY = 'shelfy_analytics_consent'
const CHANGE_EVENT = 'shelfy:consent-change'

/** Current stored choice, or null when the user hasn't decided yet. */
export function getConsent(): ConsentState | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'granted' || value === 'denied' ? value : null
  } catch {
    return null
  }
}

/** Persist a choice and notify listeners (banner ↔ settings stay in sync). */
export function setConsent(state: ConsentState): void {
  try {
    localStorage.setItem(STORAGE_KEY, state)
  } catch {
    // Private-mode / storage-disabled — treat as ephemeral; still notify.
  }
  window.dispatchEvent(new CustomEvent<ConsentState>(CHANGE_EVENT, { detail: state }))
}

/** True only when the user has explicitly opted in. */
export function hasAnalyticsConsent(): boolean {
  return getConsent() === 'granted'
}

/** Subscribe to consent changes. Returns an unsubscribe function. */
export function onConsentChange(listener: (state: ConsentState) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<ConsentState>).detail)
  window.addEventListener(CHANGE_EVENT, handler)
  return () => window.removeEventListener(CHANGE_EVENT, handler)
}
