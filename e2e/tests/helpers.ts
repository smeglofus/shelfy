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
/**
 * @param alreadyOnLoginPage  Pass true when the page is already at /login
 *   (e.g. redirected by a ProtectedRoute) to avoid a second page.goto('/login')
 *   that would wipe out the saved return-path and land the app on /books instead
 *   of the original destination.
 */
/**
 * Keep the analytics consent banner out of e2e. It renders app-wide and its
 * "Privacy Policy" link would otherwise collide with page-level locators.
 * Tests run with analytics declined — deterministic, no tracking during CI.
 * Must be called before the page first navigates (addInitScript runs on load).
 */
export async function suppressConsentBanner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('shelfy_analytics_consent', 'denied')
    } catch {
      /* storage disabled — banner may show, harmless */
    }
  })
}

export async function login(page: Page, alreadyOnLoginPage = false): Promise<void> {
  const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com'
  const password = process.env.E2E_ADMIN_PASSWORD ?? 'change-me'

  await suppressConsentBanner(page)

  if (!alreadyOnLoginPage) {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')
  }

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

  // LoginPage navigates to "/" on success; HomeRoute then goes to /books.
  // If a ProtectedRoute saved a return path, the app may land on ANY protected
  // route after login (e.g. /bookshelf?tab=locations, /books/new).
  // Accept any URL that is not /login — the caller is responsible for asserting
  // the final URL.  30 s budget: CI backends can be slow to warm up.
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 30_000 })
  await page.waitForLoadState('networkidle')

  // Dismiss the onboarding modal if it appears (fresh CI accounts always see it).
  // The modal uses position:fixed and intercepts pointer events on nav buttons.
  const onboardingModal = page.getByRole('dialog', { name: /Welcome to Shelfy|Vítejte v Shelfy/i })
  if (await onboardingModal.isVisible()) {
    await page.getByRole('button', { name: /Skip all|Přeskočit vše/i }).click()
    await onboardingModal.waitFor({ state: 'hidden' })
  }

  // The header eyebrow shows the active library's real name (fresh users get
  // "<prefix> library"), falling back to the i18n label — match both.
  // Only assert it when login landed on /books; return-path logins may land on
  // another protected route such as /settings or /bookshelf?tab=locations.
  if (/\/books$/.test(new URL(page.url()).pathname)) {
    await expect(page.getByText(/knihovna|library/i).first()).toBeVisible()
  }
}

/**
 * Create a manual book and assert it appears in the book list.
 * Caller must already be logged in.
 */
export async function createManualBook(page: Page, title: string, author = 'E2E Autor'): Promise<void> {
  // Navigate to /books/new via SPA — triggers a protected-route auth check
  // without a full page.reload() (which would re-bootstrap auth in CI).
  //
  // Desktop (>=768px): sidebar has a direct "Add" / "Přidat" button.
  // Mobile (<768px):  bottom nav has a FAB button (aria-label="Actions")
  //   that opens a menu with "Add book" / "Přidat knihu".
  //
  // Try desktop sidebar first, fall back to mobile FAB flow.
  const desktopAddBtn = page.getByRole('button', { name: /^Add$|^Přidat$/i })
  if (await desktopAddBtn.isVisible().catch(() => false)) {
    await desktopAddBtn.click()
  } else {
    // Mobile: click FAB (aria-label="Actions") to open the action menu,
    // then pick "Add book" / "Přidat knihu" from the menu items.
    await page.getByRole('button', { name: /Akce|Actions/i }).first().click()
    await page.getByRole('menuitem', { name: /Přidat knihu|Add book/i }).click()
  }
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
  await suppressConsentBanner(page)
  await page.goto(path)
  // Wait for networkidle so React's async auth bootstrap (POST /auth/refresh) can
  // complete and potentially redirect to /login before we inspect the URL.
  await page.waitForLoadState('networkidle')
  if (/\/login$/.test(new URL(page.url()).pathname)) {
    // We are already on /login (auth-redirect).  Pass alreadyOnLoginPage=true so
    // login() does NOT call page.goto('/login') again — that would overwrite the
    // saved return-path and cause the app to land on /books after login instead
    // of the original destination.  With the return-path intact the app navigates
    // back to `path` via SPA (no reload), and we can skip a second page.goto.
    await login(page, true)
    if (!new RegExp(`${escapedPath}$`).test(page.url())) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
    }
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
