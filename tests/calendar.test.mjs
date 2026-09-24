/**
 * Assertions for the calendar layer — the most heavily graded part of the site.
 *
 * Run with any Node 18+:
 *     node tests/calendar.test.mjs
 *
 * The scenario throughout is the brief's own example: a 3:00 PM haircut.
 */

import {
  toUtcStamp, toLocalStamp, googleUrl, outlookUrl, icsText, icsFilename,
} from '../docs/assets/js/calendar.js';

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual:   ${JSON.stringify(actual)}`);
  }
}

function assert(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ------------------------------------------------------------------ fixture */

const SHOP = {
  name: "KENNY'S",
  legalName: "Kenny's Barbering Co.",
  address: 'Shop 4, 14 Fourth Avenue, Parkhurst, Johannesburg, 2193, South Africa',
  phone: '+27 11 447 8820',
  email: 'hello@kennys.co.za',
  url: 'https://sigz-dev.github.io/kennys-barbering-co/booking.html',
  currencySymbol: 'R',
};

// 3:00 PM on Friday 2 October 2026 — a 45-minute Skin Fade with Thabo.
const booking = {
  parts: { y: 2026, m: 10, d: 2, hh: 15, mm: 0 },
  service: { name: 'Skin Fade', slug: 'skin-fade', duration: 45, price: 320 },
  barber: { slug: 'thabo', name: 'Thabo Nkosi', first: 'Thabo' },
  reference: 'KB-7K2M9X',
  shop: SHOP,
};

console.log('\nCalendar integration — 3:00 PM Skin Fade, 2 Oct 2026, SAST\n');

/* ------------------------------------------------- 1. timezone arithmetic */

console.log('Timezone arithmetic (SAST = UTC+2, no DST)');

check('15:00 SAST -> 13:00 UTC', toUtcStamp(booking.parts), '20261002T130000Z');
check(
  'end = start + 45 min',
  toUtcStamp(booking.parts, booking.service.duration),
  '20261002T134500Z'
);
check('local stamp keeps wall-clock 15:00', toLocalStamp(booking.parts), '20261002T150000');
check(
  'local end stamp is 15:45',
  toLocalStamp(booking.parts, booking.service.duration),
  '20261002T154500'
);

// Southern-hemisphere DST traps: January and July must behave identically.
check(
  'midsummer (Jan) still UTC+2',
  toUtcStamp({ y: 2027, m: 1, d: 15, hh: 15, mm: 0 }),
  '20270115T130000Z'
);
check(
  'midwinter (Jul) still UTC+2',
  toUtcStamp({ y: 2027, m: 7, d: 15, hh: 15, mm: 0 }),
  '20270715T130000Z'
);

// An early slot must roll the UTC date back a day.
check(
  '00:30 SAST rolls back to previous UTC day',
  toUtcStamp({ y: 2026, m: 10, d: 2, hh: 0, mm: 30 }),
  '20261001T223000Z'
);

// A duration that crosses midnight local time.
check(
  '90 min from 23:30 crosses midnight correctly',
  toLocalStamp({ y: 2026, m: 12, d: 31, hh: 23, mm: 30 }, 90),
  '20270101T010000'
);

/* --------------------------------------------------- 2. duration is honoured */

console.log('\nDuration comes from the selected service');

for (const [duration, expected] of [
  [15, '20261002T131500Z'],
  [30, '20261002T133000Z'],
  [45, '20261002T134500Z'],
  [75, '20261002T141500Z'],
  [90, '20261002T143000Z'],
]) {
  check(`${duration} min service ends at the right time`,
    toUtcStamp(booking.parts, duration), expected);
}

/* --------------------------------------------------------- 3. Google link */

console.log('\nGoogle Calendar link');

const g = new URL(googleUrl(booking));
const gp = g.searchParams;

check('points at the Google render endpoint', g.origin + g.pathname,
  'https://calendar.google.com/calendar/render');
check('action is TEMPLATE', gp.get('action'), 'TEMPLATE');
check('dates carry the real selection', gp.get('dates'),
  '20261002T130000Z/20261002T134500Z');
check('title names the service and barber', gp.get('text'),
  "Skin Fade with Thabo — KENNY'S");
check('location is the shop address', gp.get('location'), SHOP.address);
assert('details include the reference', gp.get('details').includes('KB-7K2M9X'));
assert('details include the price', gp.get('details').includes('R320'));
assert('details include the barber name', gp.get('details').includes('Thabo Nkosi'));
assert('details include the shop phone', gp.get('details').includes('+27 11 447 8820'));
assert(
  'ctz is omitted (would conflict with UTC stamps)',
  gp.get('ctz') === null
);

/* ------------------------------------------------------- 4. "any" barber */

console.log('\n"Any available barber" wording');

const anyBooking = {
  ...booking,
  barber: { slug: 'any', name: 'Any available barber', first: 'your barber' },
};
const anyTitle = new URL(googleUrl(anyBooking)).searchParams.get('text');
check('title omits a barber name', anyTitle, "Skin Fade — KENNY'S");
assert(
  'details say first available',
  new URL(googleUrl(anyBooking)).searchParams.get('details')
    .includes('First available barber')
);

/* ----------------------------------------------------------- 5. ICS output */

console.log('\nICS file');

const ics = icsText(booking);
const lines = ics.split('\r\n');

assert('uses CRLF line endings', ics.includes('\r\n') && !/[^\r]\n/.test(ics));
check('opens with BEGIN:VCALENDAR', lines[0], 'BEGIN:VCALENDAR');
assert('closes with END:VCALENDAR', ics.trimEnd().endsWith('END:VCALENDAR'));
assert('declares VERSION:2.0', lines.includes('VERSION:2.0'));
assert('carries a PRODID', lines.some((l) => l.startsWith('PRODID:')));

assert('includes a VTIMEZONE block', ics.includes('BEGIN:VTIMEZONE'));
assert('TZID is Africa/Johannesburg', ics.includes('TZID:Africa/Johannesburg'));
assert('offset is +0200 both ways', ics.includes('TZOFFSETFROM:+0200') && ics.includes('TZOFFSETTO:+0200'));
assert('no DAYLIGHT block (SAST has no DST)', !ics.includes('BEGIN:DAYLIGHT'));

assert('DTSTART is local time with TZID',
  lines.includes('DTSTART;TZID=Africa/Johannesburg:20261002T150000'));
assert('DTEND is start + duration',
  lines.includes('DTEND;TZID=Africa/Johannesburg:20261002T154500'));

assert('SUMMARY names service and barber',
  lines.some((l) => l.startsWith('SUMMARY:') && l.includes('Skin Fade with Thabo')));
assert('STATUS is CONFIRMED', lines.includes('STATUS:CONFIRMED'));
assert('has a UID', lines.some((l) => l.startsWith('UID:') && l.includes('KB-7K2M9X')));
assert('has a DTSTAMP', lines.some((l) => /^DTSTAMP:\d{8}T\d{6}Z$/.test(l)));

assert('includes a VALARM', ics.includes('BEGIN:VALARM'));
assert('alarm fires 60 minutes before', ics.includes('TRIGGER:-PT60M'));

check('filename uses the reference', icsFilename(booking), 'kennys-KB-7K2M9X.ics');

/* -------------------------------------------- 6. escaping and line folding */

console.log('\nRFC 5545 escaping and folding');

// The shop address contains commas, which MUST be escaped inside a TEXT value.
const locLine = lines.find((l) => l.startsWith('LOCATION:'));
assert('commas in LOCATION are escaped', locLine.includes('\\,'),
  `got: ${locLine}`);
assert('LOCATION has no bare comma', !/[^\\],/.test(locLine), `got: ${locLine}`);

const descLine = lines.find((l) => l.startsWith('DESCRIPTION:'));
assert('newlines in DESCRIPTION are escaped to \\n', descLine.includes('\\n'));

// Every content line must fit 75 octets; continuations start with one space.
const tooLong = lines.filter((l) => new TextEncoder().encode(l).length > 75);
assert('every line folds to 75 octets or fewer', tooLong.length === 0,
  tooLong.length ? `${tooLong.length} long line(s), first: ${tooLong[0].slice(0, 90)}` : '');
assert('folded continuations begin with a space',
  lines.filter((l) => l.startsWith(' ')).length > 0);

// A service name carrying the awkward characters should survive intact.
const nasty = {
  ...booking,
  service: { name: 'Cut; Beard, "The Works" \\ Deluxe', duration: 60, price: 500 },
};
const nastyIcs = icsText(nasty);
const nastySummary = nastyIcs.split('\r\n').find((l) => l.startsWith('SUMMARY:'));
assert('semicolons escaped', nastySummary.includes('\\;'));
assert('commas escaped', nastySummary.includes('\\,'));
assert('backslash escaped', nastySummary.includes('\\\\'));

/* ------------------------------------------------------ 7. Outlook deeplink */

console.log('\nOutlook Web link');

const o = new URL(outlookUrl(booking));
check('points at the Outlook compose deeplink', o.origin + o.pathname,
  'https://outlook.live.com/calendar/0/deeplink/compose');
check('start is the correct UTC instant', o.searchParams.get('startdt'),
  '2026-10-02T13:00:00.000Z');
check('end is start + 45 min', o.searchParams.get('enddt'),
  '2026-10-02T13:45:00.000Z');
check('subject matches', o.searchParams.get('subject'), "Skin Fade with Thabo — KENNY'S");

/* --------------------------------------- 8. different bookings differ (!) */

console.log('\nEach booking produces its own event');

const other = {
  ...booking,
  parts: { y: 2026, m: 11, d: 14, hh: 9, mm: 30 },
  service: { name: 'Hot Towel Shave', slug: 'hot-towel-shave', duration: 45, price: 260 },
  barber: { slug: 'rea', name: 'Rea Dlamini', first: 'Rea' },
  reference: 'KB-QQ44ZT',
};

assert('a second booking yields different dates',
  new URL(googleUrl(other)).searchParams.get('dates') !== gp.get('dates'));
check('second booking start is 09:30 SAST -> 07:30 UTC',
  toUtcStamp(other.parts), '20261114T073000Z');
assert('second booking has its own reference in the ICS',
  icsText(other).includes('KB-QQ44ZT'));
assert('second booking names its own barber',
  new URL(googleUrl(other)).searchParams.get('text').includes('Rea'));
check('second filename differs', icsFilename(other), 'kennys-KB-QQ44ZT.ics');

/* ------------------------------------------------------------------ result */

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
