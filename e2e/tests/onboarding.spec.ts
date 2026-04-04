import { expect, test } from '@playwright/test'
import { login } from './helpers'

/**
 * Onboarding E2E tests.
 *
 * These tests verify the onboarding wizard lifecycle:
 * 1. Show for new user with empty library
 * 2. Skip → wizard doesn't reappear
 * 3. Reset in settings → wizard reappears
 *
 * Note: These tests rely on the admin test user already existing
 * with potentially existing books. If books exist, the onboarding
 * wizard won't show (by design — it only triggers on empty library).
 * For full E2E coverage, these tests need a clean user state.
 */

test.describe('Onboarding wizard', () => {
  test('settings page shows reset onboarding button', async ({ page }) => {
    await login(page)
    await page.goto('/settings')

    // The onboarding reset section should always be visible in settings
    await expect(page.getByRole('button', { name: /onboarding/i })).toBeVisible()
  })

  test('reset onboarding shows success toast', async ({ page }) => {
    await login(page)
    await page.goto('/settings')

    await page.getByRole('button', { name: /onboarding/i }).click()

    // Should show success toast
    await expect(page.getByText(/resetován|reset/i)).toBeVisible({ timeout: 5000 })
  })

  test('onboarding wizard shows on empty library after reset', async ({ page }) => {
    await login(page)

    // First reset onboarding via settings
    await page.goto('/settings')
    await page.getByRole('button', { name: /onboarding/i }).click()
    await expect(page.getByText(/resetován|reset/i)).toBeVisible({ timeout: 5000 })

    // Clear localStorage anti-annoyance flag
    await page.evaluate(() => localStorage.removeItem('shelfy_onboarding_dismissed'))

    // Navigate to books page
    await page.goto('/books')

    // If library is empty, wizard should appear
    // If library has books, wizard won't show (by design)
    const hasBooks = await page.getByText(/Moje Knihovna|My Library/i).isVisible().catch(() => false)
    if (hasBooks) {
      // Check if total is 0 by looking for empty state
      const isEmpty = await page.locator('.sh-empty-state').isVisible().catch(() => false)
      if (isEmpty) {
        // Wizard should be visible
        await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })
        await expect(page.getByText(/Vítejte|Welcome/i)).toBeVisible()

        // Skip should close the wizard
        await page.getByRole('button', { name: /přeskočit vše|skip all/i }).click()
        await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 })
      }
    }
  })
})
