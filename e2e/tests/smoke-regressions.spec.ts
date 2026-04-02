import { expect, test } from '@playwright/test'
import { login } from './helpers'

test('books route renders (no blank screen)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await login(page)
  await page.goto('/books')
  await expect(page.getByRole('heading', { name: 'Moje Knihovna' })).toBeVisible()
  expect(errors).toEqual([])
})

test('bookshelf route renders (no blank screen)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await login(page)
  await page.goto('/bookshelf')
  await expect(page.getByRole('heading', { name: 'Digitální Dvojče' })).toBeVisible()
  expect(errors).toEqual([])
})

test('books select mode toggle renders and exits cleanly', async ({ page }) => {
  await login(page)
  await page.goto('/books')

  const selectBtn = page.getByRole('button', { name: /Vybrat|Select/i }).first()
  await selectBtn.click()
  await expect(page.getByRole('button', { name: /Zrušit výběr|deselect/i })).toBeVisible()
  await page.getByRole('button', { name: /Zrušit výběr|deselect/i }).first().click()
})

test('bookshelf reorder mode toggle renders and exits cleanly', async ({ page }) => {
  await login(page)
  await page.goto('/bookshelf')

  const reorderBtn = page.getByRole('button', { name: /Reorder|Done reordering/i }).first()
  await reorderBtn.click()
  await expect(page.getByText(/Drag books to reorder|long-press/i)).toBeVisible()
  await page.getByRole('button', { name: /Done reordering|Reorder/i }).first().click()
})

test('scan page renders main sections', async ({ page }) => {
  await login(page)
  await page.goto('/scan')
  await expect(page.getByRole('heading', { name: /Skenování police|Scan shelf/i })).toBeVisible()
})
