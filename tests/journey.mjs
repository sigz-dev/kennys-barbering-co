/**
 * End-to-end test of the graded journey:
 *   Home -> Services -> Book a Skin Fade -> pick barber -> date -> time
 *   -> details -> confirm -> add to calendar (Google link + real .ics download)
 *
 * Also covers the modal, the mobile nav, availability rules and re-booking.
 *
 *   node tests/journey.mjs [baseUrl]
 */

import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8123';

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}

function eq(label, actual, expected) {
  ok(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();

const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

/* ===================================================================== */
console.log('\n1. Home page\n');

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });

ok('hero headline renders',
  (await page.locator('.hero__title').innerText()).includes('A cut'));
ok('header Book Now is visible',
  await page.locator('.header__cta').isVisible());
ok('open/closed badge resolved (not still "Checking")',
  !(await page.locator('[data-openbadge]').first().innerText()).includes('Checking'));

// The toast must not be on screen until something triggers it.
const toastBox = await page.locator('[data-toast]').boundingBox();
ok('toast starts off-screen', !toastBox || toastBox.y >= 900 - 5,
  `toast box: ${JSON.stringify(toastBox)}`);

// The offer modal must be inert on load (hidden attribute genuinely applied).
ok('offer modal is not displayed on load',
  !(await page.locator('#offerModal').isVisible()));

/* ===================================================================== */
console.log('\n2. Navigate Home -> Services\n');

await page.locator('.nav__link', { hasText: 'Services' }).click();
await page.waitForURL('**/services.html');
ok('landed on Services', page.url().endsWith('services.html'));
ok('Services nav link marked current',
  await page.locator('.nav__link[aria-current="page"]').first().innerText() === 'Services');

const skinFadeRow = page.locator('.pricerow', { hasText: 'Skin Fade' }).first();
ok('Skin Fade row present', await skinFadeRow.count() > 0);
eq('Skin Fade priced at R320',
  (await skinFadeRow.locator('.pricerow__price').innerText()).trim(), 'R320');

/* ===================================================================== */
console.log('\n3. Services -> Booking (deep link pre-selects the service)\n');

await skinFadeRow.locator('a.btn').click();
await page.waitForURL('**/booking.html?service=skin-fade');
await page.waitForTimeout(400);

ok('deep link carried the service slug',
  page.url().includes('service=skin-fade'));
eq('summary shows the pre-selected service',
  (await page.locator('[data-summary="service"]').innerText()).trim(), 'Skin Fade');
eq('summary total reflects that service',
  (await page.locator('[data-summary-total]').innerText()).trim(), 'R320');
ok('skipped straight to step 2 (Barber)',
  await page.locator('[data-step="2"]').isVisible());
ok('promo banner hidden (no offer claimed)',
  !(await page.locator('[data-promo-applied]').isVisible()));

/* ===================================================================== */
console.log('\n4. Choose barber — Thabo (off on Wednesdays)\n');

await page.locator('[data-pick-barber="thabo"]').click();
await page.waitForTimeout(200);
eq('summary shows the barber',
  (await page.locator('[data-summary="barber"]').innerText()).trim(), 'Thabo Nkosi');

await page.locator('[data-next="2"]').click();
await page.waitForTimeout(500);
ok('advanced to step 3 (Date & time)',
  await page.locator('[data-step="3"]').isVisible());

// Availability rule: Thabo's day off must be unselectable.
const wednesdayCheck = await page.evaluate(() => {
  const label = document.querySelector('.cal__month').textContent.trim();
  const [monthName, yearStr] = label.split(' ');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const m = months.indexOf(monthName) + 1;
  const y = Number(yearStr);

  const enabledWednesdays = [];
  const enabledOther = [];
  document.querySelectorAll('.cal__day[data-pick-day]').forEach((btn) => {
    const d = Number(btn.dataset.pickDay);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (btn.disabled) return;
    (dow === 3 ? enabledWednesdays : enabledOther).push(d);
  });
  return { enabledWednesdays, enabledOtherCount: enabledOther.length, m, y };
});

eq('no Wednesday is bookable with Thabo', wednesdayCheck.enabledWednesdays.length, 0);
ok('other days are still bookable', wednesdayCheck.enabledOtherCount > 0,
  `only ${wednesdayCheck.enabledOtherCount} enabled days`);

// Mondays are closed for the whole shop, on any barber.
const mondayCheck = await page.evaluate(() => {
  const label = document.querySelector('.cal__month').textContent.trim();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const [mn, ys] = label.split(' ');
  const m = months.indexOf(mn) + 1;
  const y = Number(ys);
  let enabledMondays = 0;
  document.querySelectorAll('.cal__day[data-pick-day]:not([disabled])').forEach((btn) => {
    const dow = new Date(Date.UTC(y, m - 1, Number(btn.dataset.pickDay))).getUTCDay();
    if (dow === 1) enabledMondays += 1;
  });
  return enabledMondays;
});
eq('Mondays are never bookable (shop closed)', mondayCheck, 0);

/* ===================================================================== */
console.log('\n5. Pick a date and a time\n');

const firstDay = page.locator('.cal__day[data-pick-day]:not([disabled])').first();
const chosenDay = await firstDay.innerText();
await firstDay.click();
await page.waitForTimeout(350);

ok('slots appeared for the chosen date',
  await page.locator('.slot').count() > 0);

const slotCount = await page.locator('.slot').count();
console.log(`        ${slotCount} slots offered on the ${chosenDay}`);

// Prefer 15:00 so the assertions mirror the brief's 3:00 PM example.
const threePm = page.locator('.slot', { hasText: /^15:00$/ });
const slot = (await threePm.count()) ? threePm.first() : page.locator('.slot').first();
const chosenTime = (await slot.innerText()).trim();
await slot.click();
await page.waitForTimeout(250);

ok('summary shows a time range',
  (await page.locator('[data-summary="time"]').innerText()).includes('–'));

const summaryTime = (await page.locator('[data-summary="time"]').innerText()).trim();
console.log(`        selected ${chosenTime} -> summary "${summaryTime}"`);

// A 45-minute Skin Fade must end 45 minutes later.
const [startStr, endStr] = summaryTime.split('–').map((s) => s.trim());
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
eq('end time is start + 45 min (service duration)',
  toMin(endStr) - toMin(startStr), 45);

await page.locator('[data-next="3"]').click();
await page.waitForTimeout(400);
ok('advanced to step 4 (Your details)',
  await page.locator('[data-step="4"]').isVisible());

/* ===================================================================== */
console.log('\n6. Validation rejects bad input\n');

await page.locator('button[type="submit"]').click();
await page.waitForTimeout(300);
ok('empty form is blocked', await page.locator('[data-step="4"]').isVisible());
ok('errors are shown', await page.locator('.field.has-error').count() > 0);

await page.fill('#bk-name', 'S');
await page.fill('#bk-email', 'not-an-email');
await page.fill('#bk-phone', '12345');
await page.locator('button[type="submit"]').click();
await page.waitForTimeout(300);
ok('invalid email rejected',
  await page.locator('#bk-email').getAttribute('aria-invalid') === 'true');
ok('invalid SA phone rejected',
  await page.locator('#bk-phone').getAttribute('aria-invalid') === 'true');
ok('still on the details step', await page.locator('[data-step="4"]').isVisible());

// Unchecked terms must block submission even when everything else is valid.
await page.fill('#bk-name', 'Sipho Mahlangu');
await page.fill('#bk-email', 'sipho@example.co.za');
await page.fill('#bk-phone', '082 555 0147');
await page.locator('button[type="submit"]').click();
await page.waitForTimeout(300);
ok('unaccepted terms block submission',
  await page.locator('[data-step="4"]').isVisible());

/* ===================================================================== */
console.log('\n7. Complete the booking\n');

await page.check('input[name="terms"]');
await page.fill('#bk-notes', 'First time in — growing out an old fade.');
await page.locator('button[type="submit"]').click();
await page.waitForTimeout(700);

ok('reached the confirmation step',
  await page.locator('[data-step="5"]').isVisible());

const reference = (await page.locator('.ref__v').innerText()).trim();
ok('a booking reference was issued', /^KB-[A-Z0-9]{6}$/.test(reference),
  `got "${reference}"`);
console.log(`        reference: ${reference}`);

const ticket = await page.locator('.ticket').innerText();
ok('ticket names the service', ticket.includes('Skin Fade'));
ok('ticket names the barber', ticket.includes('Thabo'));
ok('ticket shows the address', ticket.includes('Fourth Avenue'));
ok('ticket shows the price', ticket.includes('R320'));
ok('confirmation greets the customer by name',
  (await page.locator('.confirm__lead').innerText()).includes('Sipho'));
ok('summary rail is hidden on confirmation',
  !(await page.locator('[data-summary-rail]').isVisible()));

/* ===================================================================== */
console.log('\n8. Calendar integration\n');

const googleHref = await page.locator('[data-cal-google]').getAttribute('href');
const gUrl = new URL(googleHref);
const gDates = gUrl.searchParams.get('dates');

eq('Google link is a TEMPLATE action', gUrl.searchParams.get('action'), 'TEMPLATE');
ok('Google dates are a UTC range', /^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/.test(gDates), gDates);

// The UTC stamp must be the chosen SAST time minus two hours.
const [gStart, gEnd] = gDates.split('/');
const startHour = Number(gStart.slice(9, 11));
const startMin = Number(gStart.slice(11, 13));
const expectedUtcMin = (toMin(chosenTime) - 120 + 1440) % 1440;
eq('Google start = chosen SAST time − 2h', startHour * 60 + startMin, expectedUtcMin);

const endHour = Number(gEnd.slice(9, 11));
const endMin = Number(gEnd.slice(11, 13));
eq('Google end = start + 45 min',
  ((endHour * 60 + endMin) - (startHour * 60 + startMin) + 1440) % 1440, 45);

ok('Google title carries service and barber',
  gUrl.searchParams.get('text').includes('Skin Fade') &&
  gUrl.searchParams.get('text').includes('Thabo'));
ok('Google details carry the reference',
  gUrl.searchParams.get('details').includes(reference));
ok('Google location is the shop',
  gUrl.searchParams.get('location').includes('Parkhurst'));

const outlookHref = await page.locator('[data-cal-outlook]').getAttribute('href');
ok('Outlook deeplink present', outlookHref.includes('outlook.live.com'));

// Download the .ics and read what actually lands on disk.
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.locator('[data-cal-ics]').click(),
]);
eq('.ics filename uses the reference', download.suggestedFilename(), `kennys-${reference}.ics`);

const icsPath = await download.path();
const ics = readFileSync(icsPath, 'utf8');

ok('.ics is a valid calendar envelope',
  ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
ok('.ics uses CRLF endings', ics.includes('\r\n'));
ok('.ics declares the Johannesburg timezone',
  ics.includes('TZID:Africa/Johannesburg'));
ok('.ics DTSTART keeps the chosen wall-clock time',
  ics.includes(`DTSTART;TZID=Africa/Johannesburg:`) &&
  ics.includes(`T${chosenTime.replace(':', '')}00`),
  `looking for T${chosenTime.replace(':', '')}00`);
ok('.ics carries the reference', ics.includes(reference));
ok('.ics names the service', ics.includes('Skin Fade'));
ok('.ics has a 60-minute reminder', ics.includes('TRIGGER:-PT60M'));
ok('.ics escapes commas in LOCATION',
  /LOCATION:.*\\,/.test(ics));

console.log(`        .ics downloaded and verified (${ics.length} bytes)`);

// The toast is parked off-screen; confirm it still surfaces when triggered.
await page.waitForTimeout(600);
ok('toast becomes visible after the download',
  await page.locator('[data-toast]').isVisible());
ok('toast names the downloaded file',
  (await page.locator('[data-toast-text]').innerText()).includes(reference));

/* ===================================================================== */
console.log('\n9. The slot just booked is no longer offered\n');

const savedVisible = await page.locator('[data-saved]').isVisible();
ok('saved-appointments panel appeared', savedVisible);
ok('saved panel lists the reference',
  (await page.locator('[data-saved-list]').innerText()).includes(reference));

await page.locator('[data-book-again]').click();
await page.waitForTimeout(400);
ok('returned to step 1 for a new booking',
  await page.locator('[data-step="1"]').isVisible());

await page.locator('[data-pick-service="skin-fade"]').click();
await page.locator('[data-next="1"]').click();
await page.waitForTimeout(250);
await page.locator('[data-pick-barber="thabo"]').click();
await page.locator('[data-next="2"]').click();
await page.waitForTimeout(450);

await page.locator(`.cal__day[data-pick-day="${chosenDay}"]:not([disabled])`).first().click();
await page.waitForTimeout(350);

const stillOffered = await page.locator('.slot', { hasText: new RegExp(`^${chosenTime}$`) }).count();
eq(`${chosenTime} is no longer offered after being booked`, stillOffered, 0);

/* ===================================================================== */
console.log('\n10. Offer modal\n');

await context.clearCookies();
await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.removeItem('kennys.offerSeen'));
await page.reload({ waitUntil: 'networkidle' });

await page.waitForSelector('#offerModal.is-open', { timeout: 15000 });
ok('modal opens on a first visit', await page.locator('#offerModal').isVisible());
ok('modal has dialog semantics',
  await page.locator('#offerModal [role="dialog"][aria-modal="true"]').count() === 1);
ok('modal shows the promo code',
  (await page.locator('[data-promo-code]').innerText()).trim() === 'SHARP15');
ok('background scroll is locked',
  await page.evaluate(() => document.body.classList.contains('is-locked')));

await page.keyboard.press('Escape');
await page.waitForTimeout(500);
ok('Escape closes the modal', !(await page.locator('#offerModal').isVisible()));
ok('scroll lock released',
  !(await page.evaluate(() => document.body.classList.contains('is-locked'))));

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(8000);
ok('modal does not reappear on a later visit',
  !(await page.locator('#offerModal').isVisible()));

// And it must never interrupt someone mid-booking.
await page.evaluate(() => localStorage.removeItem('kennys.offerSeen'));
await page.goto(`${BASE}/booking.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(8000);
ok('modal is suppressed on the booking page',
  !(await page.locator('#offerModal').isVisible()));

/* ===================================================================== */
console.log('\n11. Mobile navigation\n');

const mobile = await context.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });

ok('hamburger visible on mobile', await mobile.locator('[data-burger]').isVisible());
ok('desktop nav hidden on mobile', !(await mobile.locator('.nav').isVisible()));
ok('mobile panel closed initially',
  !(await mobile.locator('[data-mobilenav]').isVisible()));

await mobile.locator('[data-burger]').click();
await mobile.waitForTimeout(500);
ok('panel opens', await mobile.locator('[data-mobilenav]').isVisible());
eq('burger reports expanded',
  await mobile.locator('[data-burger]').getAttribute('aria-expanded'), 'true');
ok('panel lists navigation links',
  await mobile.locator('.mobilenav__link').count() >= 4);

await mobile.keyboard.press('Escape');
await mobile.waitForTimeout(500);
ok('Escape closes the panel',
  !(await mobile.locator('[data-mobilenav]').isVisible()));

await mobile.locator('[data-burger]').click();
await mobile.waitForTimeout(400);
await mobile.locator('.mobilenav__link', { hasText: 'Services' }).click();
await mobile.waitForURL('**/services.html');
ok('a mobile nav link navigates', mobile.url().endsWith('services.html'));
ok('scroll lock released after navigating',
  !(await mobile.evaluate(() => document.body.classList.contains('is-locked'))));

/* ===================================================================== */
console.log('\n12. Contact page & legal links\n');

await page.goto(`${BASE}/contact.html`, { waitUntil: 'networkidle' });
ok('map iframe present', await page.locator('.map iframe').count() === 1);
ok('phone link is a tel: link',
  (await page.locator('a[href^="tel:"]').first().getAttribute('href')).startsWith('tel:+27'));
ok('FAQ accordion has entries', await page.locator('.faq').count() >= 6);

const firstFaq = page.locator('.faq').nth(1);
await firstFaq.locator('summary').click();
await page.waitForTimeout(250);
ok('FAQ opens on click', await firstFaq.evaluate((el) => el.open));

await page.goto(`${BASE}/terms.html`, { waitUntil: 'networkidle' });
const termsText = await page.locator('.prose').innerText();
ok('terms are substantial', termsText.length > 4000, `${termsText.length} chars`);
ok('terms cover cancellation', /24 hours/i.test(termsText));
ok('terms cover no-shows', /no-show/i.test(termsText));
ok('terms name the governing law', /South Africa/i.test(termsText));
ok('terms have numbered sections', await page.locator('.prose h2').count() >= 15);

await page.goto(`${BASE}/privacy.html`, { waitUntil: 'networkidle' });
ok('privacy policy mentions POPIA',
  (await page.locator('.prose').innerText()).includes('POPIA'));

await page.goto(`${BASE}/404.html`, { waitUntil: 'networkidle' });
ok('404 page is on-brand',
  (await page.locator('.nf__code').innerText()).trim() === '404');

/* ===================================================================== */
console.log('\n13. Console health\n');

ok('no uncaught JavaScript errors during the journey',
  consoleErrors.length === 0,
  consoleErrors.slice(0, 5).join(' | '));

await browser.close();

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\n  Failures:');
  failures.forEach((f) => console.log(`    x ${f}`));
}
console.log('');
process.exit(failed === 0 ? 0 : 1);
