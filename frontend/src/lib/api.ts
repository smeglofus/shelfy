import axios, { type AxiosError, type AxiosRequestConfig } from 'axios'

import { clearTokens, getCsrfToken, setAccessToken } from './auth'
import type {
  AccessTokenResponse,
  AddMemberRequest,
  BillingInterval,
  BillingStatus,
  Borrower,
  BorrowerCreateRequest,
  BorrowerListParams,
  BorrowerListResponse,
  BorrowerLoanItem,
  BorrowerUpdateRequest,
  CheckoutResponse,
  CsvImportConfirmRequest,
  CsvImportConfirmResponse,
  CsvImportPreviewResponse,
  OAuthAuthorizeResponse,
  OAuthCallbackRequest,
  PortalResponse,
  QuotaErrorDetail,
  Book,
  BookCreateRequest,
  BookListParams,
  BookListResponse,
  BookUpdateRequest,
  BulkDeleteRequest,
  BulkMoveRequest,
  BulkOperationResponse,
  BulkReorderRequest,
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
  PaidPlan,
  PasswordResetConfirmPayload,
  PasswordResetRequestPayload,
  PasswordResetRequestResponse,
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

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL

export function getActiveLibraryId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_LIBRARY_ID_KEY)
  } catch {
    return null
  }
}

function clearActiveLibraryId(): void {
  try {
    localStorage.removeItem(ACTIVE_LIBRARY_ID_KEY)
  } catch {
    // ignore storage failures
  }
}

async function recoverActiveLibraryIdFromServer(): Promise<string | null> {
  try {
    // Cookie-auth: no Authorization header; axios instance has
    // withCredentials=true so the httpOnly access_token cookie flows.
    const response = await apiClient.get<Library[]>('/api/v1/libraries')
    const nextId = response.data[0]?.id ?? null
    if (nextId) {
      localStorage.setItem(ACTIVE_LIBRARY_ID_KEY, nextId)
      return nextId
    }
    clearActiveLibraryId()
    return null
  } catch {
    return null
  }
}

if (!apiBaseUrl) {
  throw new Error('VITE_API_BASE_URL is not set. Check your .env file.')
}

const apiClient = axios.create({
  baseURL: apiBaseUrl,
  // Send HttpOnly auth cookies on cross-origin XHR. Paired with
  // allow_credentials=True on the backend CORS middleware.
  withCredentials: true,
})

// ── Auth epoch (issue #125) ────────────────────────────────────────────────
// Every auth transition (login, OAuth callback, logout, bootstrap) bumps the
// epoch. Every outbound request is tagged with ``_authEpoch`` at send time,
// so when a 401 comes back we can tell whether the request was even issued
// under the CURRENT auth session.
//
// Why: the reported repro is "logout → quick Google login", where an
// in-flight ``/auth/me`` from the old session returns 401 AFTER the new
// session is established. Previously the generic 401 path would (a) kick off
// a refresh that itself 401'd, then (b) call ``onUnauthorized`` → ``logout``,
// silently tearing down the freshly-logged-in user. With the epoch tag the
// stale 401 is recognised and dropped without any side effects; legitimate
// 401s in the current session still refresh and, on failure, still log out.
let authEpoch = 0

export function bumpAuthEpoch(): number {
  authEpoch += 1
  return authEpoch
}

export function getAuthEpoch(): number {
  return authEpoch
}

type AuthAwareConfig = AxiosRequestConfig & {
  _retry?: boolean
  _libraryRetry?: boolean
  _authEpoch?: number
}

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
  if (!refreshPromise) {
    // Capture the epoch at the moment refresh starts. If auth state has moved
    // on by the time this settles (e.g. a relogin completed concurrently —
    // see issue #125), we MUST NOT run the side-effects below: promoting a
    // stale token would desync React state, and firing ``onUnauthorized``
    // would tear down a perfectly valid new session.
    const startEpoch = authEpoch
    // Empty body — the backend reads the HttpOnly refresh_token cookie.
    // The response sets a fresh access_token cookie via Set-Cookie which
    // the browser will attach to subsequent requests automatically.
    refreshPromise = apiClient
      .post<AccessTokenResponse | TokenResponse>('/api/v1/auth/refresh', {})
      .then((response) => {
        if (authEpoch !== startEpoch) return null
        const nextAccessToken = response.data.access_token
        setAccessToken(nextAccessToken)
        onTokenRefresh?.(nextAccessToken)
        return nextAccessToken
      })
      .catch(() => {
        if (authEpoch !== startEpoch) return null
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

const CSRF_EXEMPT_PATHS = new Set<string>([
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh',
  '/api/v1/auth/google/authorize',
  '/api/v1/auth/google/callback',
])

apiClient.interceptors.request.use((config) => {
  // Auth travels in the HttpOnly cookie (withCredentials=true on the
  // instance). We no longer attach Authorization: Bearer from JS — that
  // would only work if tokens were accessible to JS, which is precisely
  // what issue #117 moved us away from.

  // Tag the request with the auth epoch at send time so the response
  // interceptor can recognise replies that belong to a superseded session
  // (see the ``authEpoch`` block above and issue #125).
  ;(config as AuthAwareConfig)._authEpoch = authEpoch

  const libraryId = getActiveLibraryId()
  if (libraryId) {
    config.headers['X-Library-Id'] = libraryId
  }

  // CSRF double-submit: echo the csrf_token cookie into a custom header
  // on mutating requests. The backend (app/core/csrf.py) rejects any
  // cookie-authenticated mutation whose header doesn't match.
  const method = (config.method ?? 'get').toUpperCase()
  const url = config.url ?? ''
  const requiresCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method) && !CSRF_EXEMPT_PATHS.has(url)
  if (requiresCsrf) {
    const csrf = getCsrfToken()
    if (csrf) {
      config.headers['X-CSRF-Token'] = csrf
    }
  }

  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ detail?: string }>) => {
    const originalRequest = error.config as AuthAwareConfig | undefined

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      // Refresh-endpoint deadlock guard. When /auth/refresh itself returns
      // 401 (no / expired refresh cookie — the canonical fresh-visitor
      // scenario), we MUST NOT recursively call ``refreshAccessToken``:
      // singleflight would hand back the same in-flight promise, which
      // depends on this very axios call's interceptor chain finishing —
      // a circular wait that hangs the whole bootstrap. Let the 401
      // propagate so the outer ``.catch`` in refreshAccessToken can finish.
      const requestUrl = originalRequest.url ?? ''
      if (requestUrl.includes('/api/v1/auth/refresh')) {
        return Promise.reject(error)
      }

      // Stale-session guard for #125. If the request was issued under a
      // prior auth epoch, this 401 tells us nothing about the CURRENT
      // session; do NOT trigger refresh (which would 401 again) and do NOT
      // let it cascade into a logout. Reject silently — the caller's
      // component is usually already unmounted or gated by isAuthenticated.
      const requestEpoch = originalRequest._authEpoch
      if (typeof requestEpoch === 'number' && requestEpoch !== authEpoch) {
        return Promise.reject(error)
      }

      originalRequest._retry = true
      const nextAccessToken = await refreshAccessToken()

      if (nextAccessToken) {
        // Retry with the same cookies now pointing at the rotated
        // access_token — no header tweak needed.
        return apiClient(originalRequest)
      }
    }
    const requestUrl = originalRequest?.url ?? ''
    const hadLibraryHeader = Boolean(getActiveLibraryId())

    if (error.response?.status === 403 && originalRequest && !originalRequest._libraryRetry && hadLibraryHeader && !requestUrl.includes('/api/v1/libraries')) {
      originalRequest._libraryRetry = true
      const recoveredLibraryId = await recoverActiveLibraryIdFromServer()
      if (recoveredLibraryId) {
        originalRequest.headers = originalRequest.headers ?? {}
        originalRequest.headers['X-Library-Id'] = recoveredLibraryId
        return apiClient(originalRequest)
      }
    }

    return Promise.reject(error)
  },
)

export function formatApiError(error: unknown): string {
  if (axios.isAxiosError<{ detail?: unknown }>(error)) {
    const detail = error.response?.data?.detail

    if (typeof detail === 'string') {
      return detail
    }

    if (detail && typeof detail === 'object' && 'code' in detail) {
      const code = (detail as { code?: unknown }).code
      if (typeof code === 'string' && code.includes('limit')) {
        return 'Usage limit reached. Please upgrade your plan.'
      }
    }

    return error.message || 'Request failed.'
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

export async function requestPasswordReset(
  payload: PasswordResetRequestPayload,
): Promise<PasswordResetRequestResponse> {
  const response = await apiClient.post<PasswordResetRequestResponse>(
    '/api/v1/auth/password-reset/request',
    payload,
  )
  return response.data
}

export async function confirmPasswordReset(payload: PasswordResetConfirmPayload): Promise<void> {
  await apiClient.post('/api/v1/auth/password-reset/confirm', payload)
}

export async function refreshToken(): Promise<AccessTokenResponse | TokenResponse> {
  // Cookie-based: empty body, the backend reads the httpOnly refresh_token cookie.
  const response = await apiClient.post<AccessTokenResponse | TokenResponse>('/api/v1/auth/refresh', {})
  return response.data
}

export async function logout(): Promise<void> {
  // Server clears all three auth cookies on the response. Ignore errors —
  // the frontend still clears its local state regardless.
  try {
    await apiClient.post('/api/v1/auth/logout')
  } catch {
    /* best-effort */
  }
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

/**
 * Fetch the **complete** book dataset for the library, ordered for bookshelf
 * rendering.
 *
 * This is a deliberately different endpoint from ``listBooks`` — it has no
 * pagination. BookshelfView needs every book for every location or its
 * reorder flow will build payloads that collide with the books that were
 * hidden by pagination (issue #128). Do not use this for generic browsing;
 * the payload can be large for sizable libraries.
 */
// ── ETag cache for /books/shelf ────────────────────────────────────────────
// Keyed by libraryId so multi-library users get correct isolation.
const _shelfEtagCache = new Map<string, { etag: string; data: Book[] }>()

export async function listBooksForShelf(): Promise<Book[]> {
  const libraryId = getActiveLibraryId()
  const cached = libraryId ? _shelfEtagCache.get(libraryId) : undefined

  const headers: Record<string, string> = {}
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag
  }

  const response = await apiClient.get<Book[]>('/api/v1/books/shelf', {
    headers,
    // Axios throws on 304 by default; allow it so we can handle cache hits
    validateStatus: (status) => status === 200 || status === 304,
  })

  if (response.status === 304) {
    if (cached) {
      return cached.data
    }
    // No cached payload and a 304 — should not happen, but refetch safely
    const refetch = await apiClient.get<Book[]>('/api/v1/books/shelf')
    const etag = refetch.headers['etag'] ?? ''
    if (libraryId && etag) {
      _shelfEtagCache.set(libraryId, { etag, data: refetch.data })
    }
    return refetch.data
  }

  // 200 — store or update cache
  const etag = response.headers['etag'] ?? ''
  if (libraryId && etag) {
    _shelfEtagCache.set(libraryId, { etag, data: response.data })
  }
  return response.data
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

export async function bulkReorderBooks(payload: BulkReorderRequest): Promise<BulkOperationResponse> {
  const response = await apiClient.post<BulkOperationResponse>('/api/v1/books/bulk/reorder', payload)
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

export async function listBorrowers(params: BorrowerListParams = {}): Promise<BorrowerListResponse> {
  const response = await apiClient.get<BorrowerListResponse>('/api/v1/borrowers', {
    params: {
      search: params.search?.trim() ? params.search.trim() : undefined,
      page: params.page ?? 1,
      page_size: params.pageSize ?? 20,
    },
  })
  return response.data
}

export async function getBorrower(id: string): Promise<Borrower> {
  const response = await apiClient.get<Borrower>(`/api/v1/borrowers/${id}`)
  return response.data
}

export async function listBorrowerLoans(id: string): Promise<BorrowerLoanItem[]> {
  const response = await apiClient.get<BorrowerLoanItem[]>(`/api/v1/borrowers/${id}/loans`)
  return response.data
}

export async function createBorrower(payload: BorrowerCreateRequest): Promise<Borrower> {
  const response = await apiClient.post<Borrower>('/api/v1/borrowers', payload)
  return response.data
}

export async function updateBorrower(id: string, payload: BorrowerUpdateRequest): Promise<Borrower> {
  const response = await apiClient.patch<Borrower>(`/api/v1/borrowers/${id}`, payload)
  return response.data
}

export async function mergeBorrowers(targetId: string, sourceId: string): Promise<Borrower> {
  const response = await apiClient.post<Borrower>(
    `/api/v1/borrowers/${targetId}/merge`,
    { source_id: sourceId },
  )
  return response.data
}

export async function anonymizeBorrower(id: string): Promise<Borrower> {
  const response = await apiClient.post<Borrower>(`/api/v1/borrowers/${id}/anonymize`)
  return response.data
}

export interface BorrowerRetentionAnonymizeRequest {
  inactive_since: string  // ISO date 'YYYY-MM-DD'
  dry_run?: boolean
}

export interface BorrowerBulkAnonymizeResponse {
  affected: number
}

export async function bulkAnonymizeBorrowersByDate(
  payload: BorrowerRetentionAnonymizeRequest,
): Promise<BorrowerBulkAnonymizeResponse> {
  const response = await apiClient.post<BorrowerBulkAnonymizeResponse>(
    '/api/v1/borrowers/bulk-anonymize-by-date',
    payload,
  )
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

export async function exportBooksCsv(locationId?: string): Promise<Blob> {
  const response = await apiClient.get('/api/v1/books/export', {
    responseType: 'blob',
    params: locationId ? { location_id: locationId } : undefined,
  })
  return response.data as Blob
}

export async function previewCsvImport(file: File): Promise<CsvImportPreviewResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await apiClient.post<CsvImportPreviewResponse>(
    '/api/v1/books/import/preview',
    formData,
  )
  return response.data
}

export async function confirmCsvImport(
  payload: CsvImportConfirmRequest,
): Promise<CsvImportConfirmResponse> {
  const response = await apiClient.post<CsvImportConfirmResponse>(
    '/api/v1/books/import/confirm',
    payload,
  )
  return response.data
}


export async function purgeLibrary(password = ""): Promise<PurgeLibraryResponse> {
  const response = await apiClient.post<PurgeLibraryResponse>('/api/v1/settings/purge-library', { password })
  return response.data
}

export interface ClearSampleLibraryResponse {
  deleted_books: number
  deleted_locations: number
}

export async function clearSampleLibrary(): Promise<ClearSampleLibraryResponse> {
  const response = await apiClient.delete<ClearSampleLibraryResponse>('/api/v1/settings/sample-library')
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

// ── Billing ────────────────────────────────────────────────────────────────

export async function getBillingStatus(): Promise<BillingStatus> {
  const response = await apiClient.get<BillingStatus>('/api/v1/billing/status')
  return response.data
}

/**
 * Kick off a Stripe Checkout session.
 *
 * Backend contract (CheckoutRequest): `{ plan: 'home'|'pro'|'library', interval?: 'monthly'|'yearly' }`
 * — `interval` defaults to `'monthly'` on the server. We always send it
 * explicitly when we know the user's choice, but omit it at the call-site-level
 * for backward-compat with any older internal caller that passes only a plan.
 */
export async function createCheckoutSession(
  plan: PaidPlan,
  interval?: BillingInterval,
): Promise<CheckoutResponse> {
  const payload: { plan: PaidPlan; interval?: BillingInterval } = { plan }
  if (interval) payload.interval = interval
  const response = await apiClient.post<CheckoutResponse>('/api/v1/billing/checkout', payload)
  return response.data
}

export async function createPortalSession(): Promise<PortalResponse> {
  const response = await apiClient.post<PortalResponse>('/api/v1/billing/portal')
  return response.data
}

// ── Google OAuth ───────────────────────────────────────────────────────────

export async function getGoogleAuthorizeUrl(): Promise<OAuthAuthorizeResponse> {
  const response = await apiClient.get<OAuthAuthorizeResponse>('/api/v1/auth/google/authorize')
  return response.data
}

export async function googleOAuthCallback(payload: OAuthCallbackRequest): Promise<TokenResponse> {
  const response = await apiClient.post<TokenResponse>('/api/v1/auth/google/callback', payload)
  return response.data
}

// ── GDPR ───────────────────────────────────────────────────────────────────

export async function deleteAccount(password = ""): Promise<void> {
  await apiClient.delete('/api/v1/auth/me', { data: { password } })
  clearActiveLibraryId()
}

export async function exportUserData(): Promise<Blob> {
  const response = await apiClient.get('/api/v1/auth/me/export', { responseType: 'blob' })
  return response.data as Blob
}

// ── Global quota-error handler ────────────────────────────────────────────
// Intercepts 402 (quota_exceeded) and 403 with an upgrade_url so the
// UpgradePrompt can be shown from any mutation without per-call handling.

function _isQuotaDetail(detail: unknown): detail is QuotaErrorDetail {
  return (
    typeof detail === 'object' &&
    detail !== null &&
    'code' in detail &&
    'upgrade_url' in detail
  )
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ detail?: unknown }>) => {
    const httpStatus = error.response?.status
    const detail = error.response?.data?.detail

    if ((httpStatus === 402 || httpStatus === 403) && _isQuotaDetail(detail)) {
      // Lazy import to break circular dep — store is loaded after api.ts
      const { useUpgradeStore } = await import('../store/useUpgradeStore')
      useUpgradeStore.getState().show(detail)
    }

    return Promise.reject(error)
  },
)
