import { test, expect } from '@playwright/test'

test.describe('password reset flow', () => {
  test('@p0 forgot password -> reset password -> login with new password', async ({ page }) => {
    let activePassword = 'OldPassword123'
    let isLoggedIn = false

    await page.route('**/api/v1/auth/me', async (route) => {
      if (isLoggedIn) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'user-1', email: 'reset.e2e@example.com' }),
        })
        return
      }
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Not authenticated' }),
      })
    })

    await page.route('**/api/v1/auth/password-reset/request', async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      })
    })

    await page.route('**/api/v1/auth/password-reset/confirm', async (route) => {
      const payload = route.request().postDataJSON() as { token?: string; new_password?: string }
      if (payload.token !== 'valid-reset-token') {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ detail: 'Invalid token' }) })
        return
      }
      activePassword = payload.new_password ?? activePassword
      await route.fulfill({ status: 204, body: '' })
    })

    await page.route('**/api/v1/auth/login', async (route) => {
      const payload = route.request().postDataJSON() as { email?: string; password?: string }
      if (payload.email === 'reset.e2e@example.com' && payload.password === activePassword) {
        isLoggedIn = true
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ access_token: 'access-token', refresh_token: 'refresh-token', token_type: 'bearer' }),
        })
        return
      }
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Invalid credentials' }) })
    })

    await page.route('**/api/v1/books**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 0, page: 1, page_size: 20, items: [] }),
      })
    })

    await page.route('**/api/v1/locations', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    await page.route('**/api/v1/onboarding/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ should_show: false, completed_at: null, skipped_at: null }),
      })
    })

    await page.goto('/forgot-password')
    await page.locator('input[type="email"]').fill('reset.e2e@example.com')
    await page.getByRole('button', { name: /Send reset link|Odeslat reset odkaz/i }).click()

    await expect(page.getByText(/If an account exists for that email|Pokud pro tento e-mail existuje účet/i)).toBeVisible()

    await page.goto('/reset-password?token=valid-reset-token')
    await page.locator('input[type="password"]').first().fill('BrandNew1234')
    await page.locator('input[type="password"]').nth(1).fill('BrandNew1234')
    await page.getByRole('button', { name: /Reset password|Resetovat heslo/i }).click()

    await page.waitForURL(/\/login$/)
    await expect(page.getByText(/Password reset successfully|Heslo bylo úspěšně změněno/i)).toBeVisible()

    await page.locator('input[type="email"]').first().fill('reset.e2e@example.com')
    await page.locator('input[type="password"]').first().fill('BrandNew1234')
    await page.locator('form button[type="submit"]').click()

    await page.waitForURL(/\/books$/)
  })
})
