const ACCESS_TOKEN_KEY = 'shelfy.accessToken'
const REFRESH_TOKEN_KEY = 'shelfy.refreshToken'

function parseJwtExp(token: string): number | null {
  try {
    const [, payloadSegment] = token.split('.')
    if (!payloadSegment) {
      return null
    }

    const payload = JSON.parse(atob(payloadSegment)) as { exp?: number }
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}

export function getAccessToken(): string | null {
  return window.localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function isAccessTokenValid(token: string | null): boolean {
  if (!token) {
    return false
  }

  const exp = parseJwtExp(token)
  if (!exp) {
    return false
  }

  return exp * 1000 > Date.now()
}

export function hasValidAccessToken(): boolean {
  return isAccessTokenValid(getAccessToken())
}

export function persistTokens(accessToken: string, refreshToken: string): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function clearTokens(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY)
  window.localStorage.removeItem(REFRESH_TOKEN_KEY)
}
