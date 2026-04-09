import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type APIRequestContext } from '@playwright/test'

type LoginResponse = { access_token: string; refresh_token: string }
type LocationResponse = { id: string }
type ScanUploadResponse = { job_id: string; status: string }
type ScanResult = {
  status: 'pending' | 'processing' | 'done' | 'failed'
  books?: Array<{ position: number; title: string | null; author: string | null; isbn: string | null }>
  error_message?: string | null
}

const TEST_EMAIL = process.env.E2E_SCAN_TEST_EMAIL ?? 'e2e.scan.reset@shelfy.local'
const TEST_PASSWORD = process.env.E2E_SCAN_TEST_PASSWORD ?? 'E2e-Scan-Reset-2026!'
const API_BASE = process.env.E2E_API_BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:8000'
const FIXTURE_IMAGE = path.resolve(__dirname, '../fixtures/spine.png')

function apiUrl(p: string): string {
  return `${API_BASE.replace(/\/$/, '')}${p}`
}

async function login(request: APIRequestContext, email: string, password: string): Promise<LoginResponse | null> {
  const res = await request.post(apiUrl('/api/v1/auth/login'), {
    data: { email, password },
    failOnStatusCode: false,
  })
  if (res.status() !== 200) return null
  return (await res.json()) as LoginResponse
}

async function register(request: APIRequestContext, email: string, password: string): Promise<void> {
  const res = await request.post(apiUrl('/api/v1/auth/register'), {
    data: { email, password },
    failOnStatusCode: false,
  })
  if (![201, 409].includes(res.status())) {
    throw new Error(`register failed (${res.status()}): ${await res.text()}`)
  }
}

async function deleteMe(request: APIRequestContext, accessToken: string, password: string): Promise<void> {
  const res = await request.delete(apiUrl('/api/v1/auth/me'), {
    data: { password },
    headers: { Authorization: `Bearer ${accessToken}` },
    failOnStatusCode: false,
  })
  if (res.status() !== 204) {
    throw new Error(`delete /auth/me failed (${res.status()}): ${await res.text()}`)
  }
}

async function ensureFreshAccount(request: APIRequestContext): Promise<string> {
  const existing = await login(request, TEST_EMAIL, TEST_PASSWORD)
  if (existing?.access_token) {
    await deleteMe(request, existing.access_token, TEST_PASSWORD)
  }

  await register(request, TEST_EMAIL, TEST_PASSWORD)
  const created = await login(request, TEST_EMAIL, TEST_PASSWORD)
  if (!created?.access_token) {
    throw new Error('fresh account login failed after register')
  }
  return created.access_token
}

test.describe('scan flow with account reset', () => {
  test('@p0 can reset account, create location, scan and confirm books', async ({ request }) => {
    const accessToken = await ensureFreshAccount(request)

    const locationRes = await request.post(apiUrl('/api/v1/locations'), {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        room: 'E2E Room',
        furniture: 'E2E Shelf',
        shelf: `Run-${Date.now()}`,
      },
      failOnStatusCode: false,
    })
    expect(locationRes.status(), await locationRes.text()).toBe(201)
    const location = (await locationRes.json()) as LocationResponse

    const uploadRes = await request.post(apiUrl('/api/v1/scan/shelf'), {
      headers: { Authorization: `Bearer ${accessToken}` },
      multipart: {
        location_id: location.id,
        image: {
          name: 'spine.png',
          mimeType: 'image/png',
          buffer: fs.readFileSync(FIXTURE_IMAGE),
        },
      },
      failOnStatusCode: false,
    })
    expect(uploadRes.status(), await uploadRes.text()).toBe(202)
    const upload = (await uploadRes.json()) as ScanUploadResponse

    let result: ScanResult | null = null
    for (let i = 0; i < 35; i++) {
      const pollRes = await request.get(apiUrl(`/api/v1/scan/shelf/${upload.job_id}`), {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      expect(pollRes.status(), await pollRes.text()).toBe(200)
      result = (await pollRes.json()) as ScanResult

      if (result.status === 'done' || result.status === 'failed') break
      await new Promise((r) => setTimeout(r, 2000))
    }

    expect(result, 'scan result should be present').not.toBeNull()
    expect(result?.status, result?.error_message ?? '').toBe('done')

    const books = (result?.books ?? [])
      .filter((b) => (b.title ?? '').trim().length > 0)
      .map((b) => ({
        position: b.position,
        title: (b.title ?? '').trim(),
        author: b.author,
        isbn: b.isbn,
      }))

    expect(books.length, 'expected at least one recognized book').toBeGreaterThan(0)

    const confirmRes = await request.post(apiUrl('/api/v1/scan/confirm'), {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        location_id: location.id,
        append_after_book_id: null,
        books,
      },
      failOnStatusCode: false,
    })
    expect(confirmRes.status(), await confirmRes.text()).toBe(201)

    const booksRes = await request.get(
      apiUrl(`/api/v1/books?location_id=${location.id}&page=1&page_size=100`),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    expect(booksRes.status(), await booksRes.text()).toBe(200)
    const booksPayload = await booksRes.json() as { items?: unknown[] }
    expect((booksPayload.items ?? []).length).toBeGreaterThan(0)
  })
})
