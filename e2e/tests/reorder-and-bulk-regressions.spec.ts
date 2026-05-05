import { expect, test, type Page } from '@playwright/test'
import { createLocatedBook, createManualBook, login, navigateProtected } from './helpers'

// SPA nav to bookshelf — no page reload, auth state stays intact.
async function clickNavBookshelf(page: Page): Promise<void> {
  // nav.bookshelf i18n: en='Shelves', cs='Police'
  await page.getByRole('button', { name: /Police|Shelves/i }).click()
  await page.waitForURL(/\/bookshelf$/)
}

test('books select mode can be entered and exited without runtime crash', async ({ page }) => {
  const title = `E2E Select ${Date.now()}`
  await login(page)
  await createManualBook(page, title)
  // createManualBook ends on /books — no extra navigation needed.
  await expect(page).toHaveURL(/\/books$/)

  await page.getByRole('button', { name: /Vybrat|Bulk select/i }).first().click()
  await expect(page.getByText(/vybráno|selected/i)).toBeVisible()
  await page.getByRole('button', { name: /Zrušit výběr|Cancel selection|Deselect/i }).first().click()
})

test('books bulk move modal exposes insert-position helper', async ({ page }) => {
  const title = `E2E Bulk ${Date.now()}`
  await login(page)
  await createManualBook(page, title)
  // createManualBook ends on /books.
  await expect(page).toHaveURL(/\/books$/)

  await page.getByRole('button', { name: /Hromadný výběr|Bulk select/i }).first().click()
  // Select the specific book by clicking its card (select mode intercepts the click via
  // toggleSelect — avoids relying on `books` array being populated at the right moment).
  await page.locator('.sh-card-enter').filter({ hasText: title }).click()
  // Scope to the toolbar so we don't accidentally match "Move left"/"Move right" buttons.
  await page.locator('[role="toolbar"][aria-label="Bulk actions"]').getByRole('button', { name: /Přesunout|Move/i }).click()

  await expect(page.getByText(/Vložit na pozici|Insert at position/i)).toBeVisible()
  await expect(page.getByText(/max index|Aktuální max index/i)).toBeVisible()
})

test('bookshelf route and reorder toggle render on mobile', async ({ page }) => {
  await login(page)
  // Reorder controls only appear when at least one book is assigned to a location.
  await createLocatedBook(page, `E2E Reorder ${Date.now()}`)
  // SPA nav — no page reload, auth state stays intact.
  await clickNavBookshelf(page)

  await expect(page.getByRole('heading', { name: /Moje knihovny|My bookshelves/i })).toBeVisible()

  const reorderButton = page.getByRole('button', { name: /Přeskládat knihy|Reorder books/i }).first()
  await reorderButton.click()
  await expect(page.getByText(/Drag books to reorder|long-press/i)).toBeVisible()
})

test('"show on shelf" highlights book at shelf position 0', async ({ page }) => {
  await login(page)
  const title = `E2E Shelf Highlight ${Date.now()}`
  await createLocatedBook(page, title)
  // createLocatedBook ends on /books — no extra navigation needed.

  // Navigate to the book detail page by clicking the book card
  await page.locator('.sh-card-enter').filter({ hasText: title }).click()
  await page.waitForURL(/\/books\//)

  // Click "Show on shelf" / "Ukázat v polici"
  await page.getByRole('button', { name: /Ukázat v polici|Show on shelf/i }).click()
  await page.waitForURL(/\/bookshelf\?/)

  // Verify URL params
  const url = page.url()
  expect(url).toContain('location_id=')
  expect(url).toContain('highlight_book_id=')

  // Verify the book spine is highlighted (data-highlighted attribute present)
  await expect(page.locator('[data-highlighted]').first()).toBeVisible({ timeout: 8000 })

  // Verify the highlighted spine has the correct book title
  await expect(page.locator('[data-highlighted]').first()).toContainText(title.substring(0, 10), { ignoreCase: true })
})
