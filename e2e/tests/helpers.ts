import { expect, type Page } from '@playwright/test'

export async function login(page: Page): Promise<void> {
  const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com'
  const password = process.env.E2E_ADMIN_PASSWORD ?? 'change-me'

  await page.goto('/login')
  await page.getByPlaceholder('knihomol@email.cz').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: 'Přihlásit se' }).click()

  await expect(page).toHaveURL(/\/books$/)
  await expect(page.getByRole('heading', { name: 'Moje Knihovna' })).toBeVisible()
}


export async function createManualBook(page: Page, title: string, author = 'E2E Autor'): Promise<void> {
  await page.goto('/books/new')
  await page.getByPlaceholder('např. Duna').fill(title)
  await page.getByPlaceholder('např. Frank Herbert').fill(author)
  await page.getByRole('button', { name: 'Přidat do knihovny' }).click()
  await expect(page).toHaveURL(/\/books$/)
  await expect(page.getByText(title).first()).toBeVisible()
}
