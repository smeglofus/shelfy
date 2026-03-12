export interface Location {
  id: string
  room: string
  furniture: string
  shelf: string
  created_at: string
  updated_at: string
}

export interface LocationCreateRequest {
  room: string
  furniture: string
  shelf: string
}

export interface LocationUpdateRequest {
  room?: string
  furniture?: string
  shelf?: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
}
