import { expect, type Page } from '@playwright/test'

/**
 * Login helper — authenticates using env-overridable admin credentials.
 *
 * Root-cause note: the login form has TWO elements named "Sign in":
 *   1. A tab-toggle <button type="button"> at the top (switches between Sign-in / Register modes)
 *   2. The actual <button type="submit"> at the bottom of the <form>
 * We must target the submit button specifically; .first() would hit the tab toggle.
 *
 * After success, LoginPage navigates to "/", then HomeRoute redirects to "/books".
 * We wait for the final "/books" URL before returning.
 */
export async function login(page: Page): Promise<void> {
  const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com'
  const password = process.env.E2E_ADMIN_PASSWORD ?? 'change-me'

  await page.goto('/login')
  await page.waitForLoadState('domcontentloaded')

  await page.locator('input[type=email]').first().fill(email)
  await page.locator('input[type=password]').first().fill(password)

  // Target the <form>'s submit button, not the "Sign in" tab toggle above the form
  await page.locator('form button[type="submit"]').click()

  // LoginPage navigates to "/" on success; HomeRoute then redirects to /books.
  // 30 s budget: WebKit needs more time when the backend is warm from prior runs.
  await page.waitForURL(/\/books$/, { timeout: 30_000 })
  await page.waitForLoadState('networkidle')

  // "My Library" / "Moje Knihovna" (cs locale) is in a <p>, not a heading
  await expect(page.getByText(/Moje Knihovna|My Library/i).first()).toBeVisible()
}

/**
 * Create a manual book and assert it appears in the book list.
 * Caller must already be logged in.
 */
export async function createManualBook(page: Page, title: string, author = 'E2E Autor'): Promise<void> {
  await page.goto('/books/new')
  await page.waitForLoadState('domcontentloaded')

  await page.getByPlaceholder('např. Duna').fill(title)
  await page.getByPlaceholder('např. Frank Herbert').fill(author)
  await page.getByRole('button', { name: 'Přidat do knihovny' }).click()

  await page.waitForURL(/\/books$/, { timeout: 20_000 })
  await expect(page.getByText(title).first()).toBeVisible()
}
