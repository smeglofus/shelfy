import { expect, test } from '@playwright/test'
import { createManualBook, login } from './helpers'

test('books select mode can be entered and exited without runtime crash', async ({ page }) => {
  const title = `E2E Select ${Date.now()}`
  await login(page)
  await createManualBook(page, title)

  await page.goto('/books')
  await page.getByRole('button', { name: /Vybrat|Select/i }).first().click()
  await expect(page.getByText(/vybráno|selected/i)).toBeVisible()
  await page.getByRole('button', { name: /Zrušit výběr|deselect/i }).first().click()
})

test('books bulk move modal exposes insert-position helper', async ({ page }) => {
  await login(page)
  await page.goto('/books')

  await page.getByRole('button', { name: /Vybrat|Select/i }).first().click()
  await page.getByRole('button', { name: /Vybrat vše|Select all/i }).first().click()
  await page.getByRole('button', { name: /Přesunout|Move/i }).first().click()

  await expect(page.getByText(/Vložit na pozici|Insert at position/i)).toBeVisible()
  await expect(page.getByText(/max index|Aktuální max index/i)).toBeVisible()
})

test('bookshelf route and reorder toggle render on mobile', async ({ page }) => {
  await login(page)
  await page.goto('/bookshelf')
  await expect(page.getByRole('heading', { name: /Digitální Dvojče/i })).toBeVisible()

  const reorderButton = page.getByRole('button', { name: /Reorder|Done reordering/i }).first()
  await reorderButton.click()
  await expect(page.getByText(/Drag books to reorder|long-press/i)).toBeVisible()
})
