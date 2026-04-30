/**
 * Smoke regression suite — basic route / UI sanity checks.
 *
 * Navigation note (mirrors the rationale in p0-release-gate.spec.ts):
 *   Every full-page reload of a protected route triggers a fresh SPA mount,
 *   which re-runs the AuthContext bootstrap effect and calls POST
 *   /api/v1/auth/refresh if the in-memory access-token marker has been
 *   cleared. Under CI timing pressure this can fail and redirect the browser
 *   to /login, causing every subsequent assertion to fail.
 *
 *   Rule: do NOT call page.goto() on a protected route after login().
 *   • login() already lands on /books — no need to reload it.
 *   • For other protected routes use SPA client-side navigation (clicking the
 *     nav buttons) so the SPA router changes the URL without a page reload and
 *     the AuthContext state is preserved intact.
 *
 *   This matches the pattern documented and used in p0-release-gate.spec.ts.
 */
import { expect, test, type Page } from '@playwright/test'
import { createManualBook, getE2EAccessToken, login } from './helpers'

// ── SPA navigation helpers ────────────────────────────────────────────────────
// Click the sidebar/bottom-nav button and wait for the URL to settle.
// These avoid a full page reload and therefore avoid re-running the auth
// bootstrap — the same technique used by clickSettingsNav in p0-release-gate.

async function clickNavBookshelf(page: Page): Promise<void> {
  // nav.bookshelf i18n: en='Shelves', cs='Police'
  await page.getByRole('button', { name: /Police|Shelves/i }).click()
  await page.waitForURL(/\/bookshelf$/)
}

async function clickNavScan(page: Page): Promise<void> {
  // nav.scan i18n: en='Scan', cs='Sken'
  await page.getByRole('button', { name: /^Sken$|^Scan$/i }).click()
  await page.waitForURL(/\/scan$/)
}


function getApiAuthHeaders(page: Page): Record<string, string> {
  // APIRequestContext does not reliably mirror the browser's CSRF double-submit
  // state in CI. Reuse the access token captured by login() and use the
  // backend's Bearer-token path for test fixture setup.
  const accessToken = getE2EAccessToken(page)
  expect(accessToken, 'login() did not capture an access token for fixture setup').toBeTruthy()
  return { Authorization: `Bearer ${accessToken}` }
}

async function createLocatedBook(page: Page, title: string, author = 'E2E Autor'): Promise<void> {
  const headers = getApiAuthHeaders(page)
  const suffix = Date.now()
  const api = process.env.E2E_API_BASE_URL ?? 'http://localhost:8000'

  const locationResponse = await page.request.post(`${api}/api/v1/locations`, {
    headers,
    data: {
      room: `E2E Room ${suffix}`,
      furniture: 'E2E Bookshelf',
      shelf: 'Shelf 1',
      display_order: 0,
    },
  })
  if (!locationResponse.ok()) {
    throw new Error(`location fixture failed: ${locationResponse.status()} ${await locationResponse.text()}`)
  }
  const location = await locationResponse.json() as { id: string }

  const bookResponse = await page.request.post(`${api}/api/v1/books`, {
    headers,
    data: {
      title,
      author,
      location_id: location.id,
      shelf_position: 0,
    },
  })
  if (!bookResponse.ok()) {
    throw new Error(`book fixture failed: ${bookResponse.status()} ${await bookResponse.text()}`)
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('public landing communicates audience and trust positioning', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Najdi plán podle toho, kdo knihovnu používá|Pick the plan by who shares the shelves/i })).toBeVisible()
  await expect(page.getByText(/škola|classroom|school/i).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: /Důvěra bez marketingové mlhy|Trust without marketing fog/i })).toBeVisible()
  await expect(page.getByText(/Export|account deletion|smazání účtu/i).first()).toBeVisible()
})

test('public pricing communicates intended audience per plan', async ({ page }) => {
  await page.goto('/pricing')
  await expect(page.getByTestId('plan-card-free')).toContainText(/menší domácí sbírky|small home collections/i)
  await expect(page.getByTestId('plan-card-library')).toContainText(/školy, spolky a malé knihovny|schools, associations, and small libraries/i)
})

test('books route renders (no blank screen)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await login(page)
  // login() already navigates to /books and waits for networkidle — no
  // additional page.goto('/books') needed; an extra reload would re-bootstrap
  // auth unnecessarily and is the source of CI flakiness this file was fixed
  // to eliminate.
  await expect(page).toHaveURL(/\/books$/)
  await expect(page.getByText(/Moje Knihovna|My Library/i).first()).toBeVisible()
  expect(errors).toEqual([])
})

test('bookshelf route renders (no blank screen)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await login(page)
  // SPA nav — no page reload, auth state stays intact.
  await clickNavBookshelf(page)
  await expect(page.getByRole('heading', { name: /Moje knihovny|My bookshelves/i })).toBeVisible()
  expect(errors).toEqual([])
})

test('books select mode toggle renders and exits cleanly', async ({ page }) => {
  await login(page)
  await createManualBook(page, `E2E Smoke Select ${Date.now()}`)
  // createManualBook ends on /books — no reload needed.
  await expect(page).toHaveURL(/\/books$/)

  const selectBtn = page.getByRole('button', { name: /Hromadný výběr|Bulk select|Select/i }).first()
  await selectBtn.click()
  await expect(page.getByText(/vybráno|selected/i)).toBeVisible()
  await page.getByRole('button', { name: /Zrušit výběr|Deselect/i }).first().click()
})

test('bookshelf reorder mode toggle renders and exits cleanly', async ({ page }) => {
  await login(page)
  // Bookshelf only renders reorder controls when at least one visible book is
  // assigned to a shelf/location. A plain manual book is unassigned and appears
  // only in /books, so create this fixture directly with a location.
  await createLocatedBook(page, `E2E Smoke Reorder ${Date.now()}`)
  await clickNavBookshelf(page)

  const reorderBtn = page.getByRole('button', { name: /Přeskládat knihy|Reorder books/i }).first()
  await reorderBtn.click()
  await expect(page.getByText(/Přetáhni knihy pro změnu pořadí|Drag books to reorder|long-press/i)).toBeVisible()
  await page.getByRole('button', { name: /Uložit pořadí|Save order/i }).first().click()
})

test('scan page renders main sections', async ({ page }) => {
  await login(page)
  // SPA nav — no page reload, auth state stays intact.
  await clickNavScan(page)
  await expect(page.getByRole('heading', { name: /Skenovat polici|Scan shelf/i })).toBeVisible()
})
