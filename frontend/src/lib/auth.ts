const ACCESS_TOKEN_KEY = 'shelfy.accessToken'

function parseJwtExp(token: string): number | null {
  try {
    const [, payloadSegment] = token.split('.')
    if (!payloadSegment) {
      return null
    }

    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '=',
    )

    const payload = JSON.parse(atob(padded)) as { exp?: number }
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

export function persistTokens(accessToken: string): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
}

export function clearTokens(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY)
}
