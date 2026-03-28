import axios, { type AxiosError, type AxiosRequestConfig } from 'axios'

import { clearTokens, getAccessToken, getRefreshToken, setAccessToken, setRefreshToken } from './auth'
import type {
  AccessTokenResponse,
  Book,
  BookCreateRequest,
  BookListParams,
  BookListResponse,
  BookUpdateRequest,
  JobStatusResponse,
  Loan,
  LoanCreateRequest,
  LoanReturnRequest,
  Location,
  LocationCreateRequest,
  LocationUpdateRequest,
  LoginRequest,
  RegisterRequest,
  TokenResponse,
  UploadJobResponse,
  User,
} from './types'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL

if (!apiBaseUrl) {
  throw new Error('VITE_API_BASE_URL is not set. Check your .env file.')
}

const apiClient = axios.create({
  baseURL: apiBaseUrl,
})

let onUnauthorized: (() => void) | null = null
let onTokenRefresh: ((accessToken: string) => void) | null = null
let refreshPromise: Promise<string | null> | null = null

export function registerAuthHandlers(handlers: {
  onUnauthorized: (() => void) | null
  onTokenRefresh: ((accessToken: string) => void) | null
}): void {
  onUnauthorized = handlers.onUnauthorized
  onTokenRefresh = handlers.onTokenRefresh
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    return null
  }

  if (!refreshPromise) {
    refreshPromise = apiClient
      .post<AccessTokenResponse | TokenResponse>('/api/v1/auth/refresh', {
        refresh_token: refreshToken,
      })
      .then((response) => {
        const nextAccessToken = response.data.access_token
        setAccessToken(nextAccessToken)
        onTokenRefresh?.(nextAccessToken)

        if ('refresh_token' in response.data && response.data.refresh_token) {
          setRefreshToken(response.data.refresh_token)
        }

        return nextAccessToken
      })
      .catch(() => {
        clearTokens()
        onUnauthorized?.()
        return null
      })
      .finally(() => {
        refreshPromise = null
      })
  }

  return refreshPromise
}

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ detail?: string }>) => {
    const originalRequest = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true
      const nextAccessToken = await refreshAccessToken()

      if (nextAccessToken) {
        originalRequest.headers = originalRequest.headers ?? {}
        originalRequest.headers.Authorization = `Bearer ${nextAccessToken}`
        return apiClient(originalRequest)
      }
    }

    return Promise.reject(error)
  },
)

export function formatApiError(error: unknown): string {
  if (axios.isAxiosError<{ detail?: string }>(error)) {
    return error.response?.data?.detail ?? error.message
  }

  return 'Something went wrong. Please try again.'
}

export async function login(payload: LoginRequest): Promise<TokenResponse> {
  const response = await apiClient.post<TokenResponse>('/api/v1/auth/login', payload)
  return response.data
}

export async function register(payload: RegisterRequest): Promise<User> {
  const response = await apiClient.post<User>('/api/v1/auth/register', payload)
  return response.data
}

export async function refreshToken(payload: { refresh_token: string }): Promise<AccessTokenResponse | TokenResponse> {
  const response = await apiClient.post<AccessTokenResponse | TokenResponse>('/api/v1/auth/refresh', payload)
  return response.data
}

export async function getCurrentUser(): Promise<User> {
  const response = await apiClient.get<User>('/api/v1/auth/me')
  return response.data
}

export async function listLocations(): Promise<Location[]> {
  const response = await apiClient.get<Location[]>('/api/v1/locations')
  return response.data
}

export async function createLocation(payload: LocationCreateRequest): Promise<Location> {
  const response = await apiClient.post<Location>('/api/v1/locations', payload)
  return response.data
}

export async function updateLocation(id: string, payload: LocationUpdateRequest): Promise<Location> {
  const response = await apiClient.patch<Location>(`/api/v1/locations/${id}`, payload)
  return response.data
}

export async function deleteLocation(id: string): Promise<void> {
  await apiClient.delete(`/api/v1/locations/${id}`)
}

export async function listBooks(params: BookListParams = {}): Promise<BookListResponse> {
  const response = await apiClient.get<BookListResponse>('/api/v1/books', {
    params: {
      search: params.search,
      location_id: params.locationId,
      reading_status: params.readingStatus,
      page: params.page ?? 1,
      page_size: params.pageSize ?? 20,
    },
  })

  return response.data
}

export async function getBook(id: string): Promise<Book> {
  const response = await apiClient.get<Book>(`/api/v1/books/${id}`)
  return response.data
}

export async function createBook(payload: BookCreateRequest): Promise<Book> {
  const response = await apiClient.post<Book>('/api/v1/books', payload)
  return response.data
}

export async function updateBook(id: string, payload: BookUpdateRequest): Promise<Book> {
  const response = await apiClient.patch<Book>(`/api/v1/books/${id}`, payload)
  return response.data
}

export async function deleteBook(id: string): Promise<void> {
  await apiClient.delete(`/api/v1/books/${id}`)
}

export async function listLoans(bookId: string): Promise<Loan[]> {
  const response = await apiClient.get<Loan[]>(`/api/v1/books/${bookId}/loans`)
  return response.data
}

export async function createLoan(bookId: string, payload: LoanCreateRequest): Promise<Loan> {
  const response = await apiClient.post<Loan>(`/api/v1/books/${bookId}/loans`, payload)
  return response.data
}

export async function returnLoan(bookId: string, loanId: string, payload: LoanReturnRequest): Promise<Loan> {
  const response = await apiClient.patch<Loan>(`/api/v1/books/${bookId}/loans/${loanId}/return`, payload)
  return response.data
}

export async function uploadBookImage(file: File): Promise<UploadJobResponse> {
  const formData = new FormData()
  formData.append('image', file)
  const response = await apiClient.post<UploadJobResponse>('/api/v1/books/upload', formData)
  return response.data
}

export async function getJobStatus(id: string): Promise<JobStatusResponse> {
  const response = await apiClient.get<JobStatusResponse>(`/api/v1/jobs/${id}`)
  return response.data
}

export async function exportBooksCsv(): Promise<Blob> {
  const response = await apiClient.get('/api/v1/books/export', { responseType: 'blob' })
  return response.data as Blob
}
