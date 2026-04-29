import { expect, test } from '@playwright/test'
import { createManualBook, login } from './helpers'

test('books route renders (no blank screen)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await login(page)
  await page.goto('/books')
  await expect(page.getByText(/Moje Knihovna|My Library/i).first()).toBeVisible()
  expect(errors).toEqual([])
})

test('bookshelf route renders (no blank screen)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await login(page)
  await page.goto('/bookshelf')
  await expect(page.getByRole('heading', { name: /Moje knihovny|My Libraries/i })).toBeVisible()
  expect(errors).toEqual([])
})

test('books select mode toggle renders and exits cleanly', async ({ page }) => {
  await login(page)
  await createManualBook(page, `E2E Smoke Select ${Date.now()}`)
  await page.goto('/books')

  const selectBtn = page.getByRole('button', { name: /Hromadný výběr|Bulk select|Select/i }).first()
  await selectBtn.click()
  await expect(page.getByText(/vybráno|selected/i)).toBeVisible()
  await page.getByRole('button', { name: /Zrušit výběr|Deselect/i }).first().click()
})

test('bookshelf reorder mode toggle renders and exits cleanly', async ({ page }) => {
  await login(page)
  await createManualBook(page, `E2E Smoke Reorder ${Date.now()}`)
  await page.goto('/bookshelf')

  const reorderBtn = page.getByRole('button', { name: /Přeskládat knihy|Reorder books|Reorder/i }).first()
  await reorderBtn.click()
  await expect(page.getByText(/Přetáhni knihy|Drag books to reorder|long-press/i)).toBeVisible()
  await page.getByRole('button', { name: /Uložit pořadí|Save order|Done reordering/i }).first().click()
})

test('scan page renders main sections', async ({ page }) => {
  await login(page)
  await page.goto('/scan')
  await expect(page.getByRole('heading', { name: /Skenovat polici|Scan shelf/i })).toBeVisible()
})
