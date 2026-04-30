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
import { createManualBook, login } from './helpers'

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
  await createManualBook(page, `E2E Smoke Reorder ${Date.now()}`)
  // createManualBook ends on /books — use SPA nav to reach bookshelf.
  await clickNavBookshelf(page)

  const reorderBtn = page.getByRole('button', { name: /Přeskládat knihy|Reorder books|Reorder/i }).first()
  await reorderBtn.click()
  await expect(page.getByText(/Přetáhni knihy|Drag books to reorder|long-press/i)).toBeVisible()
  await page.getByRole('button', { name: /Uložit pořadí|Save order|Done reordering/i }).first().click()
})

test('scan page renders main sections', async ({ page }) => {
  await login(page)
  // SPA nav — no page reload, auth state stays intact.
  await clickNavScan(page)
  await expect(page.getByRole('heading', { name: /Skenovat polici|Scan shelf/i })).toBeVisible()
})
