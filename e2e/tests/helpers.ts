import { expect, type Page } from '@playwright/test'

const e2eAccessTokens = new WeakMap<Page, string>()

export function getE2EAccessToken(page: Page): string | null {
  return e2eAccessTokens.get(page) ?? null
}

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

  const loginResponsePromise = page.waitForResponse((response) => (
    response.url().includes('/api/v1/auth/login') && response.request().method() === 'POST'
  ))

  // Target the <form>'s submit button, not the "Sign in" tab toggle above the form
  await page.locator('form button[type="submit"]').click()
  const loginResponse = await loginResponsePromise
  if (!loginResponse.ok()) {
    throw new Error(`login failed: ${loginResponse.status()} ${await loginResponse.text()}`)
  }
  const tokenBody = await loginResponse.json() as { access_token: string }
  e2eAccessTokens.set(page, tokenBody.access_token)

  // LoginPage normally navigates to "/" on success; HomeRoute then redirects
  // to /books. If a ProtectedRoute redirected us to login with a saved return
  // path, the app can legitimately land back on that protected route instead.
  // 30 s budget: WebKit needs more time when the backend is warm from prior runs.
  await page.waitForURL(/\/(books|settings)$/, { timeout: 30_000 })
  await page.waitForLoadState('networkidle')

  // Dismiss the onboarding modal if it appears (fresh CI accounts always see it).
  // The modal uses position:fixed and intercepts pointer events on nav buttons.
  const onboardingModal = page.getByRole('dialog', { name: /Welcome to Shelfy|Vítejte v Shelfy/i })
  if (await onboardingModal.isVisible()) {
    await page.getByRole('button', { name: /Skip all|Přeskočit vše/i }).click()
    await onboardingModal.waitFor({ state: 'hidden' })
  }

  // "My Library" / "Moje Knihovna" (cs locale) is in a <p>, not a heading.
  // Only assert it when login landed on /books; return-path logins may land on
  // another protected route such as /settings.
  if (/\/books$/.test(new URL(page.url()).pathname)) {
    await expect(page.getByText(/Moje Knihovna|My Library/i).first()).toBeVisible()
  }
}

/**
 * Create a manual book and assert it appears in the book list.
 * Caller must already be logged in.
 */
export async function createManualBook(page: Page, title: string, author = 'E2E Autor'): Promise<void> {
  // SPA navigation via sidebar "Add" / "Přidat" button — avoids a full page
  // reload that re-triggers auth bootstrap and redirects to /login in CI.
  // Desktop viewport (>=768px): action group renders a direct sidebar button.
  await page.getByRole('button', { name: /^Add$|^Přidat$/i }).click()
  await page.waitForURL(/\/books\/new$/, { timeout: 10_000 })

  // Placeholders and submit button are locale-sensitive — cover both cs and en.
  await page.getByPlaceholder(/např\. Duna|e\.g\. Dune/i).fill(title)
  await page.getByPlaceholder(/Frank Herbert/).fill(author)
  await page.getByRole('button', { name: /Přidat do knihovny|Add to library/i }).click()

  await page.waitForURL(/\/books$/, { timeout: 20_000 })
  await expect(page.getByText(title).first()).toBeVisible()
}

export async function navigateProtected(page: Page, path: string): Promise<void> {
  const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  await page.goto(path)
  // Wait for networkidle so React's async auth bootstrap (POST /auth/refresh) can
  // complete and potentially redirect to /login before we inspect the URL.
  await page.waitForLoadState('networkidle')
  if (/\/login$/.test(new URL(page.url()).pathname)) {
    await login(page)
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  }
  await expect(page).toHaveURL(new RegExp(`${escapedPath}$`))
}

export async function createLocatedBook(page: Page, title: string, author = 'E2E Autor'): Promise<void> {
  const token = getE2EAccessToken(page)
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const api = process.env.E2E_API_BASE_URL ?? 'http://localhost:8000'
  const suffix = Date.now()

  const locRes = await page.request.post(`${api}/api/v1/locations`, {
    headers,
    data: { room: `E2E Room ${suffix}`, furniture: 'E2E Bookshelf', shelf: 'Shelf 1', display_order: 0 },
  })
  if (!locRes.ok()) throw new Error(`location fixture: ${locRes.status()} ${await locRes.text()}`)
  const { id: locationId } = await locRes.json() as { id: string }

  const bookRes = await page.request.post(`${api}/api/v1/books`, {
    headers,
    data: { title, author, location_id: locationId, shelf_position: 0 },
  })
  if (!bookRes.ok()) throw new Error(`book fixture: ${bookRes.status()} ${await bookRes.text()}`)
}
