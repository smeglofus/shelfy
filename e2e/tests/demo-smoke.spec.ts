/**
 * Demo smoke gate (@p0) — issue #301.
 *
 * The public client-side demo (/demo/*) is the landing page's primary
 * conversion funnel AND a hard architectural contract: it must generate
 * zero data/AI/upload load on the backend. Unit tests cover the hooks'
 * store-vs-network branching, but only a real browser run can catch:
 *
 *   1. a regression that re-introduces a backend call into a demo flow,
 *   2. the lazy-loaded demo chunk (PR #299) failing to load or seed,
 *   3. navigation escaping the /demo subtree into the authenticated app.
 *
 * Network contract: the ONLY backend traffic a demo visitor may produce is
 * the documented auth bootstrap — GET /auth/me (and its POST /auth/refresh
 * follow-up after the 401). Everything else is a regression and fails this
 * spec. Analytics is out of scope (PostHog is not configured in CI and is
 * not the app backend).
 *
 * Unlike the authenticated specs, full-page `goto()`s are safe here: there
 * is no auth state to lose, and each reload only re-fires the allowed
 * bootstrap calls. The demo sandbox itself survives reloads via
 * sessionStorage (zustand persist, `shelfy:demo:v1`).
 */
import { expect, test, type Page, type Request } from '@playwright/test'

const API_BASE = (process.env.E2E_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '')

/** The auth bootstrap fired by AuthContext on every SPA mount — see #285. */
const ALLOWED_API_CALLS: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'GET', path: '/api/v1/auth/me' },
  { method: 'POST', path: '/api/v1/auth/refresh' },
]

/** Start collecting every request aimed at the backend API origin. */
function collectApiRequests(page: Page): Request[] {
  const calls: Request[] = []
  page.on('request', (request) => {
    if (request.url().startsWith(API_BASE)) calls.push(request)
  })
  return calls
}

function unexpectedApiCalls(calls: Request[]): string[] {
  return calls
    .filter(
      (request) =>
        !ALLOWED_API_CALLS.some(
          (allowed) =>
            request.method() === allowed.method &&
            new URL(request.url()).pathname === allowed.path,
        ),
    )
    .map((request) => `${request.method()} ${request.url()}`)
}

test('@p0 demo: seeded render, zero backend calls beyond auth bootstrap, stays in /demo', async ({ page }) => {
  const apiCalls = collectApiRequests(page)

  // ── Entry: /demo redirects to /demo/books; lazy chunk loads + store seeds ──
  await page.goto('/demo')
  await page.waitForURL(/\/demo\/books$/)
  await expect(page.getByRole('region', { name: /Ukázka|Demo/ })).toBeVisible()
  // A known seed title proves the lazy chunk landed AND the store seeded.
  await expect(page.getByText('Proměna', { exact: true }).first()).toBeVisible({ timeout: 15_000 })

  // ── Book detail twin: clicking a card stays inside the subtree ──
  await page.getByText('Proměna', { exact: true }).first().click()
  await page.waitForURL(/\/demo\/books\/demo-book-/)
  expect(new URL(page.url()).pathname.startsWith('/demo/')).toBe(true)

  // ── Sidebar navigation keeps the /demo prefix (demoNav rewriting, #285) ──
  await page.locator('nav').getByRole('button', { name: /Police|Shelves/i }).first().click()
  await page.waitForURL(/\/demo\/bookshelf/)

  await page.locator('nav').getByRole('button', { name: /Dlužníci|Borrowers/i }).first().click()
  await page.waitForURL(/\/demo\/borrowers$/)
  // Seeded borrower list renders (sandboxed borrowers shipped in #298).
  await expect(page.getByText('Jana Nováková').first()).toBeVisible()

  // ── Sandbox mutation: add a book, find it via search — all in-memory ──
  await page.goto('/demo/books/new')
  await page.waitForURL(/\/demo\/books\/new$/)
  const titleInput = page.locator('form input.sh-input').first()
  await titleInput.fill('E2E Demo Kniha')
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL(/\/demo\/books$/)

  const search = page.getByRole('textbox', { name: /Hledat knihy|Search books/i })
  await search.fill('E2E Demo Kniha')
  await expect(page.getByText('E2E Demo Kniha', { exact: true }).first()).toBeVisible()

  // ── The network contract, asserted over the WHOLE scenario ──
  expect(unexpectedApiCalls(apiCalls)).toEqual([])
})
