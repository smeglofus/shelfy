import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (m) => console.log('CONSOLE', m.type(), m.text()));
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('response', async (r) => {
  if (r.status() === 404) console.log('HTTP404', r.url());
});
const resp = await page.goto('https://shelfy.cz/', { waitUntil: 'domcontentloaded' });
console.log('STATUS', resp && resp.status());
await page.waitForTimeout(3000);
console.log('URL', page.url());
const text = await page.textContent('body');
console.log('BODY_TEXT_LEN', text ? text.trim().length : 0);
await browser.close();
