/**
 * Calendar integration — Google Calendar, Apple/Outlook .ics, Outlook Web.
 *
 * Every value is derived from the customer's actual selection. Nothing here is
 * hard-coded to a fixed appointment.
 *
 * Timezone: the shop is in Africa/Johannesburg (SAST), which is UTC+2 all year
 * with no daylight saving. So the wall-clock time the customer picked converts
 * to UTC by subtracting exactly 2 hours, always. We never construct a Date from
 * local browser time for this — a visitor booking from London must still get
 * 15:00 SAST, not 15:00 GMT.
 */

const TZID = 'Africa/Johannesburg';
const UTC_OFFSET_HOURS = 2;
const PRODID = '-//Kennys Barbering Co//Booking//EN';

/* ---------------------------------------------------------------- helpers */

const pad = (n) => String(n).padStart(2, '0');

/**
 * The booking's UTC instant, in milliseconds.
 * `date` is a plain {y, m, d} in SAST; `hh`/`mm` are SAST wall-clock.
 */
function utcMillis({ y, m, d, hh, mm }) {
  return Date.UTC(y, m - 1, d, hh - UTC_OFFSET_HOURS, mm, 0, 0);
}

/** YYYYMMDDTHHMMSSZ — absolute UTC stamp. */
export function toUtcStamp(parts, addMinutes = 0) {
  const t = new Date(utcMillis(parts) + addMinutes * 60000);
  return (
    `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}` +
    `T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`
  );
}

/** YYYYMMDDTHHMMSS — floating local time, paired with TZID in the .ics. */
export function toLocalStamp(parts, addMinutes = 0) {
  // Shift within SAST by doing the arithmetic in UTC, then reading back +2.
  const t = new Date(utcMillis(parts) + addMinutes * 60000 + UTC_OFFSET_HOURS * 3600000);
  return (
    `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}` +
    `T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}`
  );
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma, newline. */
function esc(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold a content line to 75 octets, continuing with a leading space.
 * Folding is byte-based, not character-based, and a multi-byte character
 * must never be split across the fold.
 */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;

  const out = [];
  let chunk = '';
  let bytes = 0;
  let limit = 75;

  for (const ch of line) {
    const size = enc.encode(ch).length;
    if (bytes + size > limit) {
      out.push(chunk);
      chunk = ch;
      bytes = size;
      limit = 74; // continuation lines carry a leading space
    } else {
      chunk += ch;
      bytes += size;
    }
  }
  out.push(chunk);
  return out.join('\r\n ');
}

/* ------------------------------------------------------------- event model */

/**
 * Normalise a booking into the fields every calendar target needs.
 * @param {object} b  { parts, service, barber, reference, shop }
 */
function describe(b) {
  const { service, barber, reference, shop } = b;

  const title = barber.slug === 'any'
    ? `${service.name} — ${shop.name}`
    : `${service.name} with ${barber.first} — ${shop.name}`;

  const lines = [
    `Appointment at ${shop.legalName}.`,
    '',
    `Service:   ${service.name}`,
    `Barber:    ${barber.slug === 'any' ? 'First available barber' : barber.name}`,
    `Duration:  ${service.duration} minutes`,
    `Price:     ${shop.currencySymbol}${service.price}`,
    `Reference: ${reference}`,
    '',
    `Where:     ${shop.address}`,
    `Phone:     ${shop.phone}`,
    '',
    'Please arrive about five minutes early so we have time for a proper',
    'consultation. We hold appointments for ten minutes past the booked time.',
    'To change or cancel, call us at least 24 hours ahead.',
  ];

  return { title, description: lines.join('\n') };
}

/* ------------------------------------------------------------------ Google */

export function googleUrl(b) {
  const { title, description } = describe(b);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    // UTC form is unambiguous in every client; do not also send ctz.
    dates: `${toUtcStamp(b.parts)}/${toUtcStamp(b.parts, b.service.duration)}`,
    details: description,
    location: b.shop.address,
    trp: 'false',
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/* ----------------------------------------------------------- Outlook (web) */

export function outlookUrl(b) {
  const { title, description } = describe(b);
  const startIso = new Date(utcMillis(b.parts)).toISOString();
  const endIso = new Date(utcMillis(b.parts) + b.service.duration * 60000).toISOString();
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: title,
    startdt: startIso,
    enddt: endIso,
    body: description,
    location: b.shop.address,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params}`;
}

/* ------------------------------------------------------------------- .ics */

export function icsText(b) {
  const { title, description } = describe(b);
  const stampNow = new Date();
  const dtstamp =
    `${stampNow.getUTCFullYear()}${pad(stampNow.getUTCMonth() + 1)}${pad(stampNow.getUTCDate())}` +
    `T${pad(stampNow.getUTCHours())}${pad(stampNow.getUTCMinutes())}${pad(stampNow.getUTCSeconds())}Z`;

  const rows = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',

    // A real VTIMEZONE makes Apple Calendar place the event correctly
    // regardless of the device's own timezone. SAST never observes DST.
    'BEGIN:VTIMEZONE',
    `TZID:${TZID}`,
    'X-LIC-LOCATION:Africa/Johannesburg',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0200',
    'TZNAME:SAST',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE',

    'BEGIN:VEVENT',
    `UID:${b.reference}-${utcMillis(b.parts)}@kennys.co.za`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=${TZID}:${toLocalStamp(b.parts)}`,
    `DTEND;TZID=${TZID}:${toLocalStamp(b.parts, b.service.duration)}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(description)}`,
    `LOCATION:${esc(b.shop.address)}`,
    `URL:${b.shop.url}`,
    `ORGANIZER;CN=${esc(b.shop.legalName)}:mailto:${b.shop.email}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'TRANSP:OPAQUE',
    `CATEGORIES:${esc('Barbershop appointment')}`,

    // A reminder an hour before is genuinely useful, not decoration.
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(`${b.service.name} at ${b.shop.name} in 1 hour`)}`,
    'TRIGGER:-PT60M',
    'END:VALARM',

    'END:VEVENT',
    'END:VCALENDAR',
  ];

  // RFC 5545 requires CRLF line endings.
  return rows.map(fold).join('\r\n') + '\r\n';
}

export function icsFilename(b) {
  return `kennys-${b.reference}.ics`;
}

/**
 * Hand the .ics to the browser.
 *
 * iOS Safari doesn't honour the download attribute on blob: URLs — the file
 * silently does nothing. There, a data: URI opened in place lets iOS hand off
 * to Calendar, which is the behaviour people actually expect on a phone.
 */
export function downloadIcs(b) {
  const text = icsText(b);
  const isIOS =
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isIOS) {
    window.location.href =
      'data:text/calendar;charset=utf-8,' + encodeURIComponent(text);
    return 'ios';
  }

  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = icsFilename(b);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'download';
}
