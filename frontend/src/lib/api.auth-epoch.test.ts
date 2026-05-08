/**
 * Regression test for the auth-epoch guard in `lib/api.ts` (ADR 007, issue #125).
 *
 * The repro the guard exists for: "logout → quick Google login". An in-flight
 * `/auth/me` from the OLD session resolves with 401 AFTER the new session is
 * established. Pre-#125 the response interceptor would (a) fire a refresh that
 * itself 401'd, then (b) call `onUnauthorized` → tear down the freshly-logged-in
 * user. The fix tags every outbound request with `_authEpoch` at send time and
 * silently rejects 401s whose epoch is stale.
 *
 * Until this file existed, the guard was only documented in comments — a future
 * refactor could remove the tagging or the stale-check without breaking any
 * test. This file pins the contract three ways:
 *
 *   1. Stale-epoch 401 rejects without firing refresh or `onUnauthorized`.
 *   2. Current-epoch 401 still fires the refresh path.
 *   3. A 401 *from* /auth/refresh itself rejects without recursion (the
 *      "refresh-endpoint deadlock guard" comment in api.ts).
 *
 * We mock `axios.create` so the api module wires its interceptors onto our
 * stub. The test then captures the response-error handler the auth interceptor
 * registered and exercises it with synthetic AxiosErrors — no network, no
 * interceptor chain to weave through.
 */
import type { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ErrorHandler = (error: AxiosError) => Promise<unknown>
type ResponseHandler = (response: AxiosResponse) => AxiosResponse | Promise<AxiosResponse>

// One shared stub instance — the api module imports axios and calls
// axios.create() exactly once at module load, so we have one instance to
// configure per test file.
const stubPost = vi.fn()
const stubGet = vi.fn()
const stubPatch = vi.fn()
const stubDelete = vi.fn()
const stubPut = vi.fn()

type RequestHandler = (
  config: InternalAxiosRequestConfig,
) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig>

// Both `interceptors.response.use(success, error)` calls in api.ts register
// here. The auth/refresh interceptor is the FIRST one registered (line ~226
// of api.ts at the time of writing); the quota interceptor is the second.
const responseInterceptors: Array<{ success: ResponseHandler; error: ErrorHandler }> = []
const requestInterceptors: Array<{ success: RequestHandler }> = []

const stubInstance = {
  post: stubPost,
  get: stubGet,
  patch: stubPatch,
  delete: stubDelete,
  put: stubPut,
  interceptors: {
    request: {
      use: (success: RequestHandler) => {
        requestInterceptors.push({ success })
        return requestInterceptors.length - 1
      },
    },
    response: {
      use: (success: ResponseHandler, error: ErrorHandler) => {
        responseInterceptors.push({ success, error })
        return responseInterceptors.length - 1
      },
    },
  },
} as const

// `apiClient(originalRequest)` is also called from inside the interceptor when
// it retries after a successful refresh. The api module imports the client and
// invokes it as a function, so the stub needs a `__call__` shape too. Easiest:
// make the stub callable.
const stubCallable: typeof stubInstance & ((...args: unknown[]) => Promise<unknown>) =
  Object.assign(
    vi.fn(async (config: unknown) => {
      stubGet(config)
      return { data: null, status: 200, statusText: 'OK', headers: {}, config }
    }),
    stubInstance,
  ) as never

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => stubCallable),
    isAxiosError: (e: unknown): e is AxiosError =>
      typeof e === 'object' && e !== null && (e as { isAxiosError?: boolean }).isAxiosError === true,
  },
  isAxiosError: (e: unknown): e is AxiosError =>
    typeof e === 'object' && e !== null && (e as { isAxiosError?: boolean }).isAxiosError === true,
}))

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeAxiosError(args: {
  status: number
  url: string
  authEpoch?: number
  retry?: boolean
}): AxiosError {
  const config = {
    url: args.url,
    headers: {},
    _authEpoch: args.authEpoch,
    _retry: args.retry,
  } as unknown as InternalAxiosRequestConfig
  const err = new Error('mock axios error') as AxiosError
  ;(err as unknown as { isAxiosError: boolean }).isAxiosError = true
  err.config = config
  err.response = {
    status: args.status,
    statusText: 'Unauthorized',
    data: {},
    headers: {},
    config,
  } as AxiosResponse
  return err
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('api.ts auth-epoch guard (ADR 007, #125)', () => {
  let authErrorHandler: ErrorHandler
  let onUnauthorized: ReturnType<typeof vi.fn>
  let onTokenRefresh: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    // The module-level singleton state in api.ts (`authEpoch`,
    // `refreshPromise`) persists across tests. We re-import per test via
    // `vi.resetModules()` so each test starts on a fresh module.
    vi.resetModules()
    responseInterceptors.length = 0
    requestInterceptors.length = 0
    stubPost.mockReset()
    stubGet.mockReset()

    const api = await import('./api')

    onUnauthorized = vi.fn()
    onTokenRefresh = vi.fn()
    api.registerAuthHandlers({ onUnauthorized, onTokenRefresh })

    // Bump the epoch once so we have a clear stale (0) vs. current (1)
    // distinction.
    api.bumpAuthEpoch()
    expect(api.getAuthEpoch()).toBe(1)

    // The first interceptor api.ts registers is the auth one — it owns the
    // refresh-on-401 path that we're testing.
    expect(responseInterceptors.length).toBeGreaterThanOrEqual(1)
    authErrorHandler = responseInterceptors[0].error
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a 401 with a stale auth epoch without firing refresh or onUnauthorized', async () => {
    const stale = makeAxiosError({
      status: 401,
      url: '/api/v1/books',
      authEpoch: 0, // older than the current 1
    })

    await expect(authErrorHandler(stale)).rejects.toBe(stale)

    // No refresh attempted — onUnauthorized untouched.
    expect(stubPost).not.toHaveBeenCalledWith(
      '/api/v1/auth/refresh',
      expect.anything(),
    )
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(onTokenRefresh).not.toHaveBeenCalled()
  })

  it('runs the refresh path on a current-epoch 401', async () => {
    // Refresh endpoint succeeds — the interceptor will retry the original.
    stubPost.mockResolvedValueOnce({
      data: { access_token: 'new-token' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    } as unknown as AxiosResponse)

    const current = makeAxiosError({
      status: 401,
      url: '/api/v1/books',
      authEpoch: 1, // matches the bumped epoch
    })

    // The retry hits stubCallable(originalRequest); we don't care about the
    // resolved value here, only that refresh fired.
    await authErrorHandler(current).catch(() => {
      // The fake `apiClient(originalRequest)` returns success; the await chain
      // resolves. If anything throws downstream the catch keeps the test from
      // bailing — we're asserting the refresh side-effect, not the retry.
    })

    expect(stubPost).toHaveBeenCalledWith('/api/v1/auth/refresh', {})
    expect(onTokenRefresh).toHaveBeenCalledWith('new-token')
  })

  it('tags every outbound request with the current _authEpoch', async () => {
    // The guard tested above is only useful if outgoing requests *carry* an
    // epoch. A future refactor that drops the tagging would silently bypass
    // the response-side check (typeof undefined !== "number" → guard skipped).
    expect(requestInterceptors.length).toBeGreaterThanOrEqual(1)
    const requestHandler = requestInterceptors[0].success

    const config = { url: '/api/v1/books', headers: {} } as InternalAxiosRequestConfig
    const tagged = (await requestHandler(config)) as InternalAxiosRequestConfig & {
      _authEpoch?: number
    }

    expect(tagged._authEpoch).toBe(1) // matches the bumped epoch from beforeEach
  })

  it('does NOT recurse on a 401 from /auth/refresh itself', async () => {
    // Fresh-visitor scenario: the bootstrap /auth/me hits this path indirectly
    // when the refresh cookie is gone. If the guard is removed, the second
    // refresh call would hang on its own singleflight promise.
    const refreshFailure = makeAxiosError({
      status: 401,
      url: '/api/v1/auth/refresh',
      authEpoch: 1,
    })

    await expect(authErrorHandler(refreshFailure)).rejects.toBe(refreshFailure)

    // The interceptor short-circuited before calling refresh recursively.
    expect(stubPost).not.toHaveBeenCalledWith(
      '/api/v1/auth/refresh',
      expect.anything(),
    )
  })
})
