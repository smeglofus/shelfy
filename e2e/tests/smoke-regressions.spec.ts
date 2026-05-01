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
import { login } from './helpers'

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

test('scan page renders main sections', async ({ page }) => {
  await login(page)
  // SPA nav — no page reload, auth state stays intact.
  await clickNavScan(page)
  await expect(page.getByRole('heading', { name: /Skenovat polici|Scan shelf/i })).toBeVisible()
})
test('auth callback with missing parameters shows safe fallback', async ({ page }) => {
  await page.goto('/auth/callback')
  await expect(page.getByText(/Missing OAuth parameters/i)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: /Back to sign in/i })).toBeVisible()
})
