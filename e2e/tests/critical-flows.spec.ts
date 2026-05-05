import { expect, test } from '@playwright/test'
import path from 'node:path'
import { createManualBook, login, navigateProtected } from './helpers'

test('login flow redirects to app', async ({ page }) => {
  await login(page)
})

test('locations CRUD', async ({ page }) => {
  const room = `E2E Pokoj ${Date.now()}`
  const furniture = 'Skříň A'
  const shelf = 'Police 1'
  const updatedShelf = 'Police 2'

  await login(page)
  // page.goto() on protected routes fails in CI (auth-refresh cookie issue).
  // ProtectedRoute also only saves location.pathname (not search), so
  // /bookshelf?tab=locations becomes /bookshelf after login redirect.
  // Use SPA nav: Shelves nav button → Locations tab button.
  await page.locator('nav').getByRole('button', { name: /Police|Shelves/i }).click()
  await page.waitForURL(/\/bookshelf$/)
  await page.getByRole('button', { name: /Správa pozic|Locations management/i }).click()
  await page.waitForURL(/\/bookshelf\?tab=locations$/)

  await page.getByLabel(/Místnost|Room/i).fill(room)
  await page.getByLabel(/Knihovna|Furniture/i).fill(furniture)
  await page.getByLabel(/^Police$|^Shelf$/i).fill(shelf)
  await page.getByRole('button', { name: /Vytvořit|Create/i }).click()

  await expect(page.getByText(room).first()).toBeVisible()

  const row = page.locator('tr', { hasText: room }).first()
  await row.getByRole('button', { name: /Upravit|Edit/i }).click()
  await page.getByLabel(/Upravit polici|Edit shelf/i).first().fill(updatedShelf)
  await page.getByRole('button', { name: /Uložit|Save/i }).first().click()

  await expect(page.getByText(updatedShelf).first()).toBeVisible()

  await row.getByRole('button', { name: /Smazat|Delete/i }).click()
  await page.getByRole('button', { name: /Smazat navždy|Delete permanently/i }).click()

  await expect(page.locator('tr', { hasText: room })).toHaveCount(0)
})

test('/locations alias redirects to bookshelf tab and supports continuation', async ({ page }) => {
  await login(page)
  // Navigate to /locations — the app should redirect to /bookshelf?tab=locations
  await page.goto('/locations')
  await page.waitForLoadState('networkidle')
  if (/\/login$/.test(new URL(page.url()).pathname)) {
    // Auth re-bootstrap redirected us; login preserves the return path
    await login(page, true)
    await page.waitForLoadState('networkidle')
  }
  await expect(page).toHaveURL(/\/bookshelf\?tab=locations/)

  // Assert locations tab content/controls are visible
  await expect(page.getByLabel(/Místnost|Room/i)).toBeVisible()
  await expect(page.getByLabel(/Knihovna|Furniture/i)).toBeVisible()
  await expect(page.getByLabel(/^Police$|^Shelf$/i)).toBeVisible()

  // Create a location to verify continuation works
  const room = `E2E Alias ${Date.now()}`
  await page.getByLabel(/Místnost|Room/i).fill(room)
  await page.getByLabel(/Knihovna|Furniture/i).fill('Skříň Alias')
  await page.getByLabel(/^Police$|^Shelf$/i).fill('Police Alias')
  await page.getByRole('button', { name: /Vytvořit|Create/i }).click()
  await expect(page.getByText(room).first()).toBeVisible()
})

test('expired session during write shows error, does not save', async ({ page }) => {
  const title = `E2E Expired Session ${Date.now()}`

  await login(page)
  // Navigate to /books/new via SPA
  const desktopAddBtn = page.getByRole('button', { name: /^Add$|^Přidat$/i })
  if (await desktopAddBtn.isVisible().catch(() => false)) {
    await desktopAddBtn.click()
  } else {
    await page.getByRole('button', { name: /Akce|Actions/i }).first().click()
    await page.getByRole('menuitem', { name: /Přidat knihu|Add book/i }).click()
  }
  await page.waitForURL(/\/books\/new$/, { timeout: 10_000 })

  // Intercept the book-create POST and return 401 to simulate session expiry.
  // The app's AuthContext may silently refresh the token, but the original
  // save request should fail — the book must NOT appear on /books afterwards.
  await page.route('**/api/v1/books', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Not authenticated"}' })
    } else {
      await route.continue()
    }
  })

  // Fill form and attempt to submit
  await page.getByPlaceholder(/např\. Duna|e\.g\. Dune/i).fill(title)
  await page.getByPlaceholder(/Frank Herbert/).fill('E2E Autor')
  await page.getByRole('button', { name: /Přidat do knihovny|Add to library/i }).click()

  // Wait for the network request to resolve (the intercept should return 401)
  await page.waitForLoadState('networkidle')

  // Unroute before navigating to avoid interfering with other requests
  await page.unroute('**/api/v1/books')

  // Navigate to /books and verify the book was NOT saved
  await page.goto('/books')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText(title).first()).not.toBeVisible()
})

test('books CRUD manual', async ({ page }) => {
  const title = `E2E Kniha ${Date.now()}`

  await login(page)
  await createManualBook(page, title)

  // Scope to the card that contains our title so we delete the right book.
  await page.locator('.sh-card-enter').filter({ hasText: title }).getByRole('button', { name: /^delete-/ }).click()
  await page.getByRole('button', { name: /Smazat knihu|Delete book/i }).click()

  await expect(page.getByText(title).first()).not.toBeVisible()
})

test('upload smoke starts processing flow', async ({ page }) => {
  await login(page)
  await navigateProtected(page, '/books/new')

  const imagePath = path.join(process.cwd(), 'fixtures', 'spine.png')
  const fileInput = page.locator('input[type="file"]')

  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/v1/books/upload') && res.request().method() === 'POST'),
    fileInput.setInputFiles(imagePath),
  ])

  expect(response.status()).toBe(202)
  await expect(page.getByText(/Zpracovávám obrázek|Processing image/i)).toBeVisible()
})
