/**
 * Screenshot every page at several breakpoints and report any console errors,
 * failed requests, or horizontal overflow.
 *
 *   node tests/shots.mjs [baseUrl]
 */

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://127.0.0.1:8123';
// fileURLToPath, not .pathname — the latter leaves %20 in paths with spaces.
const OUT = fileURLToPath(new URL('./shots/', import.meta.url));

const PAGES = ['index', 'services', 'about', 'gallery', 'booking', 'contact', 'terms', 'privacy', '404'];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, full: true },
  { name: 'mobile', width: 390, height: 844, full: true },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const problems = [];

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce', // freeze animations so shots are deterministic
  });

  for (const name of PAGES) {
    const page = await context.newPage();
    const errors = [];

    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => {
      errors.push(`request failed: ${r.url()} (${r.failure()?.errorText})`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
    });

    await page.goto(`${BASE}/${name}.html`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(500);

    // Force every reveal element visible so full-page shots aren't blank.
    await page.evaluate(() => {
      document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-in'));
    });

    // Walk the page so lazy images actually load, then return to the top.
    // A fullPage screenshot alone does not trigger loading="lazy".
    await page.evaluate(async () => {
      const step = window.innerHeight * 0.8;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForLoadState('networkidle');

    // Confirm every *visible* image decoded — a broken src would show as a gap.
    // Images inside display:none containers (the modal's media panel on narrow
    // screens, steps not yet shown) are correctly never fetched, so skip those.
    const brokenImages = await page.evaluate(() =>
      [...document.images]
        .filter((img) => img.getClientRects().length > 0)
        .filter((img) => !img.complete || img.naturalWidth === 0)
        .map((img) => img.currentSrc || img.src)
    );
    brokenImages.forEach((src) => errors.push(`image did not load: ${src}`));

    await page.waitForTimeout(300);

    const overflow = await page.evaluate(() => {
      const w = document.documentElement.scrollWidth;
      const c = document.documentElement.clientWidth;
      if (w <= c + 1) return null;
      // Identify the widest offender to make the report actionable.
      let worst = null;
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > c + 1 && (!worst || r.right > worst.right)) {
          worst = { right: Math.round(r.right), sel: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') };
        }
      });
      return { scrollWidth: w, clientWidth: c, worst };
    });

    if (overflow) {
      problems.push(
        `${name} @${vp.name}: horizontal overflow ${overflow.scrollWidth}>${overflow.clientWidth}` +
        (overflow.worst ? ` — widest: ${overflow.worst.sel} @${overflow.worst.right}px` : '')
      );
    }

    errors.forEach((e) => problems.push(`${name} @${vp.name}: ${e}`));

    await page.screenshot({
      path: `${OUT}${name}-${vp.name}.png`,
      fullPage: vp.full,
    });

    const flag = errors.length || overflow ? ' <-- ISSUE' : '';
    console.log(`  ${vp.name.padEnd(8)} ${name.padEnd(10)} captured${flag}`);
    await page.close();
  }

  await context.close();
}

await browser.close();

if (problems.length) {
  console.log(`\n  ${problems.length} PROBLEM(S):`);
  problems.forEach((p) => console.log(`    x ${p}`));
  process.exit(1);
}

console.log('\n  No console errors, no failed requests, no horizontal overflow.');
