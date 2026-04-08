/**
 * P0 Release-Gate Suite
 *
 * Every test in this file is tagged @p0.
 * Run with:
 *   npm run e2e:p0                        (chromium + mobile-safari)
 *   playwright test --grep @p0 --project=chromium
 *
 * PR gate   → chromium P0 must be fully green.
 * Pre-release gate → chromium + mobile-safari P0 must be fully green.
 *
 * Assumptions:
 *   • A user exists: E2E_ADMIN_EMAIL (default admin@example.com)
 *     with password E2E_ADMIN_PASSWORD (default change-me).
 *   • The app is live at E2E_BASE_URL (default http://localhost:5173).
 *   • Tests are independent — no shared state, no ordering dependency.
 *
 * Rate-limit note:
 *   Every full-page reload to a protected route triggers POST /api/v1/auth/refresh
 *   (the bootstrap effect in AuthContext re-runs on each SPA mount).  With the
 *   default limit of 30/min, running the suite back-to-back twice within the same
 *   minute exhausts the quota.
 *
 *   Mitigation — two layers:
 *     1. docker-compose.yml sets RATE_LIMIT_REFRESH=200/minute for local dev.
 *     2. Protected-route navigation here uses the Settings nav button (SPA client-
 *        side route change) instead of page.goto(), which avoids the page reload
 *        and the accompanying refresh call wherever possible.
 */
import { expect, test } from '@playwright/test'
import { createManualBook, login } from './helpers'

const P0 = '@p0'

// ── Suite setup: delete leftover P0 books from previous runs ─────────────────
// Prevents test-data accumulation that slows the books page and causes flaky
// timeouts when the suite is run back-to-back in local development.

test.beforeAll(async ({ request }) => {
  const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com'
  const password = process.env.E2E_ADMIN_PASSWORD ?? 'change-me'
  // Direct backend URL; same as VITE_API_BASE_URL used by the frontend.
  const api = process.env.E2E_API_BASE_URL ?? 'http://localhost:8000'

  const loginRes = await request.post(`${api}/api/v1/auth/login`, {
    data: { email, password },
  })
  if (!loginRes.ok()) return

  const { access_token } = (await loginRes.json()) as { access_token: string }
  const headers = { Authorization: `Bearer ${access_token}` }

  // Fetch books matching the P0 Persist prefix (up to 200; enough for any
  // realistic number of local dev runs).
  const booksRes = await request.get(
    `${api}/api/v1/books?search=P0+Persist&page_size=200`,
    { headers },
  )
  if (!booksRes.ok()) return

  const { items } = (await booksRes.json()) as { items: Array<{ id: string; title: string }> }
  const staleIds = items.filter((b) => b.title.startsWith('P0 Persist')).map((b) => b.id)

  if (staleIds.length > 0) {
    await request.post(`${api}/api/v1/books/bulk/delete`, {
      headers,
      data: { ids: staleIds },
    })
  }
})

/**
 * Navigate to /settings using the app's nav button (SPA routing).
 * Avoids a full page reload → no POST /api/v1/auth/refresh call.
 * nav.settings i18n: en='Settings', cs='Nastavení'
 */
async function clickSettingsNav(page: Parameters<typeof login>[0]): Promise<void> {
  await page.getByRole('button', { name: /Nastavení|Settings/i }).click()
  await page.waitForURL(/\/settings$/)
}

// ── 1. Auth guard ────────────────────────────────────────────────────────────

test(`${P0} protected routes redirect to login when unauthenticated`, async ({ page }) => {
  await page.context().clearCookies()

  for (const path of ['/books', '/settings', '/bookshelf']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login$/)
  }
})

// ── 2. Login + logout round-trip ─────────────────────────────────────────────

test(`${P0} auth login + logout flow`, async ({ page }) => {
  await login(page)

  // SPA nav — avoids full page reload and the accompanying refresh-token call
  await clickSettingsNav(page)
  // Logout button: en='Logout', cs='Odhlásit'
  await page.getByRole('button', { name: /Odhlásit|Logout/i }).first().click()

  await expect(page).toHaveURL(/\/login$/)
})

// ── 3. Books page renders ────────────────────────────────────────────────────

test(`${P0} books page renders without blank screen`, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  // login() already navigates to /books; no need for an extra page.goto('/books')
  // which would trigger a redundant full reload + refresh-token call.
  await login(page)
  await page.waitForLoadState('networkidle')

  // Title is in a <p> element (not a heading) — getByText is the right selector
  // Accept both English and Czech (cs) locale strings
  await expect(page.getByText(/Moje Knihovna|My Library/i).first()).toBeVisible()
  expect(errors).toEqual([])
})

// ── 4. Book persistence ──────────────────────────────────────────────────────

test(`${P0} create manual book persists after reload`, async ({ page }) => {
  const title = `P0 Persist ${Date.now()}`

  await login(page)
  await createManualBook(page, title, 'P0 Author')

  // Full page reload: app re-bootstraps auth from localStorage, re-fetches books
  await page.reload()
  await page.waitForURL(/\/books$/, { timeout: 30_000 })
  await page.waitForLoadState('networkidle')

  await expect(page.getByText(title).first()).toBeVisible()
})

// ── 5. Enrich — handles quota/no-quota gracefully ────────────────────────────

test(`${P0} enrich action handles quota/no-quota without crashing settings`, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await login(page)
  await clickSettingsNav(page)

  // Settings page heading: en='Settings', cs='Nastavení'
  await expect(page.getByRole('heading', { name: /Nastavení|Settings/i })).toBeVisible()

  // Button: en='Enrich missing metadata', cs='Doplnit chybějící metadata'
  const enrichBtn = page
    .getByRole('button', { name: /Doplnit chybějící metadata|Enrich missing metadata/i })
    .first()
  await enrichBtn.click()

  // Page must NOT crash regardless of 202 (no books / quota ok) or 402 (quota exceeded)
  // Settings heading must still be visible
  await expect(page.getByRole('heading', { name: /Nastavení|Settings/i })).toBeVisible()
  expect(errors).toEqual([])
})

// ── 6. GDPR export ───────────────────────────────────────────────────────────

test(`${P0} GDPR export endpoint returns attachment`, async ({ page }) => {
  await login(page)
  await clickSettingsNav(page)
  // Ensure settings page is fully rendered before interacting
  await expect(page.getByRole('heading', { name: /Nastavení|Settings/i })).toBeVisible()

  // Button: en='Download JSON export', cs='Stáhnout JSON export'
  const exportBtn = page
    .getByRole('button', { name: /Stáhnout JSON export|Download JSON export/i })
    .first()

  // waitForResponse + click in a Promise.all to avoid a race where the
  // response arrives before the handler is registered
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/auth/me/export') &&
        res.request().method() === 'GET',
      { timeout: 15_000 },
    ),
    exportBtn.click(),
  ])

  expect(response.status()).toBe(200)
  const cd = response.headers()['content-disposition'] ?? ''
  expect(cd.toLowerCase()).toContain('attachment')
})

// ── 7. Legal pages ───────────────────────────────────────────────────────────

test(`${P0} legal pages accessible and links work from settings`, async ({ page }) => {
  await login(page)
  await clickSettingsNav(page)
  // Ensure settings page is fully rendered before interacting
  await expect(page.getByRole('heading', { name: /Nastavení|Settings/i })).toBeVisible()

  // Privacy Policy link: text is hardcoded "Privacy Policy" in the component
  await page.getByRole('link', { name: /Privacy Policy/i }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(
    page.getByRole('heading', { name: /Zásady ochrany soukromí|Privacy Policy/i }),
  ).toBeVisible()

  // Return to settings — full reload here is acceptable; docker-compose sets
  // RATE_LIMIT_REFRESH=200/min so this extra call is well within budget.
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: /Nastavení|Settings/i })).toBeVisible()
  // Terms of Service link: text is hardcoded "Terms of Service" in the component
  await page.getByRole('link', { name: /Terms of Service/i }).click()
  await expect(page).toHaveURL(/\/terms$/)
  await expect(
    page.getByRole('heading', { name: /Podmínky použití|Terms of Service/i }),
  ).toBeVisible()
})

// ── 8. Library member role UX ────────────────────────────────────────────────
// Requires a second account; skipped unless E2E_EDITOR_EMAIL + E2E_EDITOR_PASSWORD are set.

const editorEmail = process.env.E2E_EDITOR_EMAIL
const editorPassword = process.env.E2E_EDITOR_PASSWORD

test(`${P0} library members owner/non-owner role UX`, async ({ page, browser }) => {
  test.skip(
    !editorEmail || !editorPassword,
    'Set E2E_EDITOR_EMAIL and E2E_EDITOR_PASSWORD to enable role-flow test',
  )

  await login(page)
  await clickSettingsNav(page)
  // Owner sees the add-member form; aria-label set in SettingsPage
  await expect(page.getByLabel('add-member-form')).toBeVisible()

  // Open a second browser context as the non-owner
  const ctx2 = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
  })
  const page2 = await ctx2.newPage()
  await page2.goto('/login')
  await page2.locator('input[type=email]').first().fill(editorEmail!)
  await page2.locator('input[type=password]').first().fill(editorPassword!)
  await page2.locator('form button[type="submit"]').click()
  await page2.waitForURL(/\/books$/, { timeout: 15_000 })

  await page2.goto('/settings')
  // Non-owner must NOT see the add-member form
  await expect(page2.getByLabel('add-member-form')).toHaveCount(0)
  await ctx2.close()
})
