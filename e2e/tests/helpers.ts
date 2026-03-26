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
