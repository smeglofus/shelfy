import axios, { type AxiosError, type AxiosRequestConfig } from 'axios'

import { clearTokens, getAccessToken, getRefreshToken, setAccessToken, setRefreshToken } from './auth'
import type {
  AccessTokenResponse,
  AddMemberRequest,
  Book,
  BookCreateRequest,
  BookListParams,
  BookListResponse,
  BookUpdateRequest,
  BulkDeleteRequest,
  BulkMoveRequest,
  BulkOperationResponse,
  BulkStatusRequest,
  EnrichBookResponse,
  EnrichResponse,
  JobStatusResponse,
  Library,
  LibraryMember,
  Loan,
  LoanCreateRequest,
  LoanReturnRequest,
  Location,
  LocationCreateRequest,
  LocationUpdateRequest,
  LoginRequest,
  OnboardingStatus,
  PurgeLibraryResponse,
  RegisterRequest,
  ShelfScanConfirmRequest,
  ShelfScanConfirmResponse,
  ShelfScanResponse,
  ShelfScanResultResponse,
  TokenResponse,
  UpdateMemberRoleRequest,
  UploadJobResponse,
  User,
} from './types'

export const ACTIVE_LIBRARY_ID_KEY = 'shelfy.activeLibraryId'

export function getActiveLibraryId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_LIBRARY_ID_KEY)
  } catch {
    return null
  }
}

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

  const libraryId = getActiveLibraryId()
  if (libraryId) {
    config.headers['X-Library-Id'] = libraryId
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
      search: params.search || undefined,
      location_id: params.locationId || undefined,
      unassigned_only: params.unassignedOnly || undefined,
      reading_status: params.readingStatus ?? undefined,
      language: params.language || undefined,
      publisher: params.publisher || undefined,
      year_from: params.yearFrom,
      year_to: params.yearTo,
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

export async function bulkDeleteBooks(payload: BulkDeleteRequest): Promise<BulkOperationResponse> {
  const response = await apiClient.post<BulkOperationResponse>('/api/v1/books/bulk/delete', payload)
  return response.data
}

export async function bulkMoveBooks(payload: BulkMoveRequest): Promise<BulkOperationResponse> {
  const response = await apiClient.post<BulkOperationResponse>('/api/v1/books/bulk/move', payload)
  return response.data
}

export async function bulkUpdateStatus(payload: BulkStatusRequest): Promise<BulkOperationResponse> {
  const response = await apiClient.post<BulkOperationResponse>('/api/v1/books/bulk/status', payload)
  return response.data
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


export async function purgeLibrary(password: string): Promise<PurgeLibraryResponse> {
  const response = await apiClient.post<PurgeLibraryResponse>('/api/v1/settings/purge-library', { password })
  return response.data
}

// Shelf scanning
export async function scanShelf(file: File, locationId?: string): Promise<ShelfScanResponse> {
  const formData = new FormData()
  formData.append('image', file)
  if (locationId) {
    formData.append('location_id', locationId)
  }
  const response = await apiClient.post<ShelfScanResponse>('/api/v1/scan/shelf', formData)
  return response.data
}

export async function getShelfScanResult(jobId: string): Promise<ShelfScanResultResponse> {
  const response = await apiClient.get<ShelfScanResultResponse>(`/api/v1/scan/shelf/${jobId}`)
  return response.data
}

export async function confirmShelfScan(payload: ShelfScanConfirmRequest): Promise<ShelfScanConfirmResponse> {
  const response = await apiClient.post<ShelfScanConfirmResponse>('/api/v1/scan/confirm', payload)
  return response.data
}

// Enrichment
export async function enrichBook(bookId: string, force = false): Promise<EnrichBookResponse> {
  const response = await apiClient.post<EnrichBookResponse>(`/api/v1/enrich/book/${bookId}`, null, {
    params: { force },
  })
  return response.data
}

export async function enrichByLocation(locationId: string, force = false): Promise<EnrichResponse> {
  const response = await apiClient.post<EnrichResponse>(`/api/v1/enrich/location/${locationId}`, null, {
    params: { force },
  })
  return response.data
}

export async function enrichAll(force = false): Promise<EnrichResponse> {
  const response = await apiClient.post<EnrichResponse>('/api/v1/enrich/all', null, {
    params: { force },
  })
  return response.data
}

// Books by location with position ordering
export async function listBooksByLocation(locationId: string): Promise<Book[]> {
  const response = await apiClient.get<BookListResponse>('/api/v1/books', {
    params: { location_id: locationId, page: 1, page_size: 100 },
  })
  return response.data.items
}

// Onboarding
export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const response = await apiClient.get<OnboardingStatus>('/api/v1/settings/onboarding')
  return response.data
}

export async function completeOnboarding(): Promise<OnboardingStatus> {
  const response = await apiClient.post<OnboardingStatus>('/api/v1/settings/onboarding/complete')
  return response.data
}

export async function skipOnboarding(): Promise<OnboardingStatus> {
  const response = await apiClient.post<OnboardingStatus>('/api/v1/settings/onboarding/skip')
  return response.data
}

export async function resetOnboarding(): Promise<OnboardingStatus> {
  const response = await apiClient.post<OnboardingStatus>('/api/v1/settings/onboarding/reset')
  return response.data
}

// Libraries
export async function listLibraries(): Promise<Library[]> {
  const response = await apiClient.get<Library[]>('/api/v1/libraries')
  return response.data
}

export async function listLibraryMembers(libraryId: string): Promise<LibraryMember[]> {
  const response = await apiClient.get<LibraryMember[]>(`/api/v1/libraries/${libraryId}/members`)
  return response.data
}

export async function addLibraryMember(libraryId: string, payload: AddMemberRequest): Promise<LibraryMember> {
  const response = await apiClient.post<LibraryMember>(`/api/v1/libraries/${libraryId}/members`, payload)
  return response.data
}

export async function updateLibraryMember(
  libraryId: string,
  userId: string,
  payload: UpdateMemberRoleRequest,
): Promise<LibraryMember> {
  const response = await apiClient.patch<LibraryMember>(`/api/v1/libraries/${libraryId}/members/${userId}`, payload)
  return response.data
}

export async function removeLibraryMember(libraryId: string, userId: string): Promise<void> {
  await apiClient.delete(`/api/v1/libraries/${libraryId}/members/${userId}`)
}
