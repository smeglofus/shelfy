import { expect, test } from '@playwright/test'
import { getE2EAccessToken, login } from './helpers'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_IMAGE = process.env.E2E_SCAN_IMAGE_PATH ?? path.resolve(__dirname, '../fixtures/scan-flow-shelf.jpg')

test.describe('scan regressions', () => {
  test('@regression @slow scan job failure shows recoverable segment UI', async ({ page }) => {
    // Login
    await login(page)

    // Create a location via API so the scan dropdown has something to select
    const token = getE2EAccessToken(page)
    expect(token, 'login() did not capture an access token').toBeTruthy()
    const api = process.env.E2E_API_BASE_URL ?? 'http://localhost:8000'
    const suffix = Date.now()
    const room = `E2E Scan Fail ${suffix}`

    const locRes = await page.request.post(`${api}/api/v1/locations`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { room, furniture: 'Shelf', shelf: 'Shelf 1', display_order: 0 },
    })
    expect(locRes.ok(), `location fixture: ${locRes.status()}`).toBeTruthy()

    // Navigate to scan page via SPA
    await page.getByRole('button', { name: /^Sken$|^Scan$/i }).click()
    await page.waitForURL(/\/scan$/)

    // Select the location we just created (room → furniture → shelf dropdowns)
    await page.locator('select').first().selectOption({ label: room })
    await page.locator('select').nth(1).selectOption({ label: 'Shelf' })
    await page.locator('select').nth(2).selectOption({ label: 'Shelf 1' })

    // Advance to the scan/photo step
    await page.getByRole('button', { name: /Continue to scanning|Pokračovat ke skenování/i }).click()

    // Intercept the job-status poll to return 'failed'
    await page.route('**/api/v1/scan/shelf/**', async (route, request) => {
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'failed', error_message: null }),
        })
      } else {
        await route.continue()
      }
    })

    // Upload the fixture image via the hidden file input
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_IMAGE)

    // Wait for the segment to show failure state
    // scan.segment_failed: cs="Zpracování selhalo", en="Processing failed"
    await expect(page.getByText(/Zpracování selhalo|Processing failed/i)).toBeVisible({ timeout: 45_000 })
  })
})
