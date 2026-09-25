/**
 * Safari / WebKit smoke test.
 *
 * Playwright's WebKit is the same engine family Safari ships, so it catches
 * the Safari-only failures Chromium hides: unsupported CSS, module parse
 * errors, date handling, blob downloads.
 *
 *   node tests/safari.mjs [baseUrl]
 */

import { webkit } from 'playwright-core';

const BASE = process.argv[2] || 'http://127.0.0.1:8123';
const PAGES = ['index', 'services', 'about', 'gallery', 'booking', 'contact', 'terms', 'privacy', '404'];

let passed = 0;
let failed = 0;

function ok(label, cond, detail = '') {
  if (cond) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
}

const browser = await webkit.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
});

console.log(`\nWebKit ${browser.version()} against ${BASE}\n`);

/* --- every page renders, with no script errors -------------------------- */

for (const name of PAGES) {
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(`${e.name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('requestfailed', (r) => errs.push(`request failed ${r.url()}`));

  let loaded = true;
  try {
    await page.goto(`${BASE}/${name}.html`, { waitUntil: 'load', timeout: 45000 });
  } catch (e) {
    loaded = false;
    errs.push(`navigation: ${e.message}`);
  }
  await page.waitForTimeout(900);

  // "Blank page" is the symptom to catch: real, laid-out content must exist.
  const rendered = await page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      text: (main?.innerText || '').trim().length,
      height: document.body.scrollHeight,
      headerVisible: !!document.querySelector('.header')?.getBoundingClientRect().height,
      bg: getComputedStyle(document.body).backgroundColor,
    };
  });

  ok(`${name}.html loads`, loaded);
  ok(`${name}.html has rendered content`, rendered.text > 200 && rendered.height > 600,
    `text=${rendered.text} height=${rendered.height}`);
  ok(`${name}.html header laid out`, rendered.headerVisible);
  ok(`${name}.html no script errors`, errs.length === 0, errs.slice(0, 4).join(' | '));

  await page.close();
}

/* --- the booking flow actually works in WebKit --------------------------- */

console.log('\nBooking flow in WebKit\n');

const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(`${e.name}: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(`${BASE}/booking.html?service=skin-fade`, { waitUntil: 'load' });
await page.waitForTimeout(900);

ok('service pre-selected from the deep link',
  (await page.locator('[data-summary="service"]').innerText()).includes('Skin Fade'));

await page.locator('[data-pick-barber="thabo"]').click();
await page.locator('[data-next="2"]').click();
await page.waitForTimeout(700);
ok('calendar rendered', await page.locator('.cal__day[data-pick-day]').count() > 20);

await page.locator('.cal__day[data-pick-day]:not([disabled])').first().click();
await page.waitForTimeout(600);
const slots = await page.locator('.slot').count();
ok('time slots generated', slots > 0, `${slots} slots`);

await page.locator('.slot').first().click();
await page.locator('[data-next="3"]').click();
await page.waitForTimeout(500);

await page.fill('#bk-name', 'Sipho Mahlangu');
await page.fill('#bk-email', 'sipho@example.co.za');
await page.fill('#bk-phone', '082 555 0147');
await page.check('input[name="terms"]');
await page.locator('button[type="submit"]').click();
await page.waitForTimeout(1200);

ok('confirmation reached', await page.locator('.ref__v').count() === 1);
const ref = (await page.locator('.ref__v').innerText()).trim();
ok('reference issued', /^KB-[A-Z0-9]{6}$/.test(ref), ref);

const gHref = await page.locator('[data-cal-google]').getAttribute('href');
ok('Google Calendar link built',
  gHref.includes('calendar.google.com') && /dates=\d{8}T\d{6}Z/.test(gHref));

// Blob download is the classic WebKit divergence.
try {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('[data-cal-ics]').click(),
  ]);
  ok('.ics downloads in WebKit', dl.suggestedFilename() === `kennys-${ref}.ics`,
    dl.suggestedFilename());
} catch (e) {
  ok('.ics downloads in WebKit', false, e.message);
}

ok('no script errors during the booking flow', errs.length === 0, errs.slice(0, 4).join(' | '));

/* --- CSS features that commonly differ ----------------------------------- */

console.log('\nCSS support\n');

const css = await page.evaluate(() => ({
  aspectRatio: CSS.supports('aspect-ratio', '1 / 1'),
  translate: CSS.supports('translate', '-50% 0'),
  svh: CSS.supports('height', '100svh'),
  focusVisible: CSS.supports('selector(:focus-visible)'),
  backdrop: CSS.supports('backdrop-filter', 'blur(4px)') ||
            CSS.supports('-webkit-backdrop-filter', 'blur(4px)'),
  gridDense: CSS.supports('grid-auto-flow', 'dense'),
}));
Object.entries(css).forEach(([k, v]) => ok(`supports ${k}`, v));

await browser.close();

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
