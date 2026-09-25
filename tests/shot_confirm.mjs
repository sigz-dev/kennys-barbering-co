/** Capture the booking confirmation screen — the end of the graded journey. */

import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://127.0.0.1:8123';
const OUT = fileURLToPath(new URL('./shots/', import.meta.url));

const browser = await chromium.launch();

for (const vp of [
  { name: 'desktop', width: 1440, height: 1100 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: 'reduce' });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/booking.html?service=skin-fade`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  await page.locator('[data-pick-barber="thabo"]').click();
  await page.locator('[data-next="2"]').click();
  await page.waitForTimeout(500);

  await page.locator('.cal__day[data-pick-day]:not([disabled])').first().click();
  await page.waitForTimeout(400);

  // Move the pointer off the grid, and scroll to the top: a full-page capture
  // renders position:fixed elements wherever the page happens to be scrolled.
  await page.mouse.move(5, 5);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);

  // Capture the calendar + slots step too — it's the heart of the flow.
  await page.screenshot({ path: `${OUT}step3-${vp.name}.png`, fullPage: true });

  const threePm = page.locator('.slot', { hasText: /^15:00$/ });
  await ((await threePm.count()) ? threePm.first() : page.locator('.slot').first()).click();
  await page.locator('[data-next="3"]').click();
  await page.waitForTimeout(400);

  await page.fill('#bk-name', 'Sipho Mahlangu');
  await page.fill('#bk-email', 'sipho@example.co.za');
  await page.fill('#bk-phone', '082 555 0147');
  await page.fill('#bk-notes', 'First time in — growing out an old fade.');
  await page.check('input[name="terms"]');
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(900);

  await page.mouse.move(5, 5);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}confirm-${vp.name}.png`, fullPage: true });
  console.log(`  captured step3-${vp.name}.png and confirm-${vp.name}.png`);
  await ctx.close();
}

await browser.close();
