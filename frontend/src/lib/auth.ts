const REFRESH_TOKEN_KEY = 'shelfy.refreshToken'

let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getRefreshToken(): string | null {
  return window.localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setRefreshToken(token: string | null): void {
  if (!token) {
    window.localStorage.removeItem(REFRESH_TOKEN_KEY)
    return
  }

  window.localStorage.setItem(REFRESH_TOKEN_KEY, token)
}

export function clearTokens(): void {
  accessToken = null
  window.localStorage.removeItem(REFRESH_TOKEN_KEY)
}
