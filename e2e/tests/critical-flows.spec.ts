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
  await page.getByRole('button', { name: /Police|Shelves/i }).click()
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
