import { expect, test } from '@playwright/test'
import path from 'node:path'
import { login } from './helpers'

test('login flow redirects to app', async ({ page }) => {
  await login(page)
})

test('locations CRUD', async ({ page }) => {
  const room = `E2E Pokoj ${Date.now()}`
  const furniture = 'Skříň A'
  const shelf = 'Police 1'
  const updatedShelf = 'Police 2'

  await login(page)
  await page.goto('/locations')

  await page.getByLabel('Room').fill(room)
  await page.getByLabel('Furniture').fill(furniture)
  await page.getByLabel('Shelf').fill(shelf)
  await page.getByRole('button', { name: 'Vytvořit' }).click()

  await expect(page.getByText(room)).toBeVisible()

  const row = page.locator('tr', { hasText: room }).first()
  await row.getByRole('button', { name: 'Upravit' }).click()
  await page.getByLabel('Edit shelf').first().fill(updatedShelf)
  await page.getByRole('button', { name: 'Uložit' }).first().click()

  await expect(page.getByText(updatedShelf).first()).toBeVisible()

  await row.getByRole('button', { name: 'Smazat' }).click()
  await page.getByRole('button', { name: 'Smazat navždy' }).click()

  await expect(page.locator('tr', { hasText: room })).toHaveCount(0)
})

test('books CRUD manual', async ({ page }) => {
  const title = `E2E Kniha ${Date.now()}`

  await login(page)
  await page.goto('/books/new')

  await page.getByPlaceholder('např. Duna').fill(title)
  await page.getByPlaceholder('např. Frank Herbert').fill('E2E Autor')
  await page.getByRole('button', { name: 'Přidat do knihovny' }).click()

  await expect(page).toHaveURL(/\/books$/)
  await expect(page.getByText(title).first()).toBeVisible()

  await page.getByLabel(/delete-/).first().click()
  await page.getByRole('button', { name: 'Smazat knihu' }).click()

  await expect(page.getByText(title).first()).not.toBeVisible()
})

test('upload smoke starts processing flow', async ({ page }) => {
  await login(page)
  await page.goto('/books/new')

  const imagePath = path.join(process.cwd(), 'fixtures', 'spine.png')
  const fileInput = page.locator('input[type="file"]')

  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/v1/books/upload') && res.request().method() === 'POST'),
    fileInput.setInputFiles(imagePath),
  ])

  expect(response.status()).toBe(202)
  await expect(page.getByText('Zpracovávám obrázek')).toBeVisible()
})
