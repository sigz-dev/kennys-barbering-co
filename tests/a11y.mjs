/**
 * Accessibility audit with axe-core across every page, plus the states that
 * only exist after interaction (modal open, mobile nav open, booking steps).
 *
 *   node tests/a11y.mjs [baseUrl]
 */

import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');

const BASE = process.argv[2] || 'http://127.0.0.1:8123';
const PAGES = ['index', 'services', 'about', 'gallery', 'booking', 'contact', 'terms', 'privacy', '404'];

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

let total = 0;
const allViolations = [];

async function scan(page, label) {
  await page.addScriptTag({ path: axePath });
  const results = await page.evaluate(
    async (tags) => await window.axe.run(document, { runOnly: { type: 'tag', values: tags } }),
    TAGS
  );
  total += 1;
  const v = results.violations;
  if (v.length) {
    v.forEach((issue) => {
      allViolations.push({
        label,
        id: issue.id,
        impact: issue.impact,
        help: issue.help,
        nodes: issue.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      });
    });
    console.log(`  ${v.length} issue(s)  ${label}`);
  } else {
    console.log(`  clean        ${label}`);
  }
}

for (const name of PAGES) {
  const page = await context.newPage();
  await page.goto(`${BASE}/${name}.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await scan(page, `${name}.html`);
  await page.close();
}

/* --- interactive states ------------------------------------------------- */

// Offer modal open
const m = await context.newPage();
await m.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await m.evaluate(() => localStorage.removeItem('kennys.offerSeen'));
await m.reload({ waitUntil: 'networkidle' });
await m.waitForSelector('#offerModal.is-open', { timeout: 15000 });
await scan(m, 'index.html (offer modal open)');
await m.close();

// Booking wizard, each step
const b = await context.newPage();
await b.goto(`${BASE}/booking.html?service=skin-fade`, { waitUntil: 'networkidle' });
await b.waitForTimeout(400);
await scan(b, 'booking.html (step 2 — barber)');

await b.locator('[data-pick-barber="thabo"]').click();
await b.locator('[data-next="2"]').click();
await b.waitForTimeout(500);
await scan(b, 'booking.html (step 3 — calendar & slots)');

await b.locator('.cal__day[data-pick-day]:not([disabled])').first().click();
await b.waitForTimeout(350);
await b.locator('.slot').first().click();
await b.locator('[data-next="3"]').click();
await b.waitForTimeout(400);
await scan(b, 'booking.html (step 4 — details)');

await b.fill('#bk-name', 'Sipho Mahlangu');
await b.fill('#bk-email', 'sipho@example.co.za');
await b.fill('#bk-phone', '082 555 0147');
await b.check('input[name="terms"]');
await b.locator('button[type="submit"]').click();
await b.waitForTimeout(700);
await scan(b, 'booking.html (step 5 — confirmation)');
await b.close();

// Mobile nav open
const mob = await context.newPage();
await mob.setViewportSize({ width: 390, height: 844 });
await mob.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await mob.locator('[data-burger]').click();
await mob.waitForTimeout(500);
await scan(mob, 'index.html (mobile nav open)');
await mob.close();

await browser.close();

console.log(`\n  ${total} states scanned against ${TAGS.join(', ')}`);

if (allViolations.length) {
  console.log(`\n  ${allViolations.length} VIOLATION(S):`);
  allViolations.forEach((v) => {
    console.log(`\n    [${v.impact}] ${v.id} — ${v.label}`);
    console.log(`      ${v.help}`);
    v.nodes.forEach((n) => console.log(`      -> ${n}`));
  });
  process.exit(1);
}

console.log('  No WCAG 2.1 A/AA violations found.');
