import { expect, test } from '@playwright/test'
import { login } from './helpers'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_IMAGE = process.env.E2E_SCAN_IMAGE_PATH ?? path.resolve(__dirname, '../fixtures/scan-flow-shelf.jpg')

test.describe('scan regressions', () => {
  test('@regression @slow scan job failure shows recoverable segment UI', async ({ page }) => {
    // Login and navigate to scan page
    await login(page)
    await page.getByRole('button', { name: /^Sken$|^Scan$/i }).click()
    await page.waitForURL(/\/scan$/)

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
    await expect(page.getByText(/Zpracování selhalo|Processing failed/i)).toBeVisible({ timeout: 30_000 })
  })
})
