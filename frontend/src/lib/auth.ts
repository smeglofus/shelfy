// Auth token handling for the SPA.
//
// Tokens are NEVER stored in localStorage / sessionStorage — all session
// state lives in HttpOnly cookies set by the backend (see backend/app/core/
// cookies.py). This module only tracks a small in-memory flag so React can
// know whether the user is authenticated without waiting for a round trip;
// the authoritative answer is always whatever /api/v1/auth/me returns.
//
// The CSRF cookie (`csrf_token`) is NOT HttpOnly on purpose: JS must read
// it to echo into the `X-CSRF-Token` header on mutations. See api.ts.

let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}

const CSRF_COOKIE_NAME = 'csrf_token'

/**
 * Read the csrf_token cookie set by the backend on login / OAuth callback.
 * Returns null if the cookie is missing (pre-login state).
 */
export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null
  const prefix = `${CSRF_COOKIE_NAME}=`
  for (const raw of document.cookie.split(';')) {
    const cookie = raw.trim()
    if (cookie.startsWith(prefix)) {
      return decodeURIComponent(cookie.substring(prefix.length))
    }
  }
  return null
}

export function clearTokens(): void {
  accessToken = null
}
