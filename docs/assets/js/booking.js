/**
 * Booking wizard: service -> barber -> date & time -> details -> confirmation.
 *
 * Availability is computed for real against opening hours, service duration,
 * each barber's day off, appointments already taken, and the current time in
 * Johannesburg. Bookings persist to localStorage so a slot you just took is
 * genuinely gone when you come back.
 */

import { SITE, SERVICES, findService, findBarber } from './site-data.js';
import {
  sastNow, dowOf, daysBetween, monthName, dayName,
  formatLongDate, formatShortDate, formatTime12, formatTime24,
  parseHm, durationLabel, toast, store,
} from './util.js';
import { googleUrl, outlookUrl, downloadIcs, icsFilename } from './calendar.js';

const BOOKINGS_KEY = 'kennys.bookings';
const STEP_COUNT = 5;

const ANY_BARBER = {
  slug: 'any',
  name: 'Any available barber',
  first: 'your barber',
  role: 'First one free',
  dayOff: -1,
  specialties: [],
};

const money = (n) => `${SITE.contact.currencySymbol}${n}`;

const SHOP = {
  name: SITE.brand.name,
  legalName: SITE.brand.legalName,
  address: SITE.contact.addressFull,
  phone: SITE.contact.phoneDisplay,
  email: SITE.contact.email,
  url: SITE.brand.baseUrl + 'booking.html',
  currencySymbol: SITE.contact.currencySymbol,
};

/* ========================================================================
   State
   ======================================================================== */

const state = {
  step: 1,
  service: null,
  barber: null,
  date: null, // {y, m, d}
  time: null, // minutes past midnight
  details: { name: '', email: '', phone: '', notes: '' },
  reference: null,
  viewMonth: null, // {y, m} currently rendered in the calendar
};

/* ========================================================================
   Availability
   ======================================================================== */

const dateKey = ({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function hoursFor(dow) {
  return SITE.hours.find((h) => h.dow === dow) || null;
}

function barbersWorking(dow) {
  return SITE.barbers.filter((b) => b.dayOff !== dow);
}

/** Stable pseudo-random so "already taken" slots don't reshuffle on reload. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** Slots already taken for a given barber on a given date. */
function takenFor(date, barberSlug) {
  const key = dateKey(date);
  const taken = new Set();

  // Seeded background bookings, so the shop looks like a working business.
  const row = hoursFor(dowOf(date));
  if (row && !row.closed) {
    const open = parseHm(row.open);
    const close = parseHm(row.close);
    for (let t = open; t < close; t += SITE.booking.slotStepMinutes) {
      if (hash(`${key}|${barberSlug}|${t}`) < 0.34) taken.add(t);
    }
  }

  // Real bookings this visitor has made.
  savedBookings().forEach((b) => {
    if (b.dateKey !== key) return;
    if (b.barberSlug !== barberSlug && b.barberSlug !== 'any') return;
    // Block the whole span the appointment occupies.
    for (let t = b.time; t < b.time + b.duration; t += SITE.booking.slotStepMinutes) {
      taken.add(t);
    }
  });

  return taken;
}

/**
 * Every bookable start time for a date, given the chosen service and barber.
 * Returns minutes past midnight.
 */
function slotsFor(date, barberSlug, service) {
  if (!date || !service) return [];

  const dow = dowOf(date);
  const row = hoursFor(dow);
  if (!row || row.closed) return [];

  const now = sastNow();
  const dayOffset = daysBetween(now, date);
  if (dayOffset < 0 || dayOffset > SITE.booking.maxDaysAhead) return [];

  const open = parseHm(row.open);
  const close = parseHm(row.close);
  const step = SITE.booking.slotStepMinutes;

  // Which barbers could actually take this appointment?
  const candidates = barberSlug === 'any'
    ? barbersWorking(dow)
    : SITE.barbers.filter((b) => b.slug === barberSlug && b.dayOff !== dow);
  if (!candidates.length) return [];

  const takenByBarber = new Map(
    candidates.map((b) => [b.slug, takenFor(date, b.slug)])
  );

  const out = [];
  for (let t = open; t + service.duration <= close; t += step) {
    // Today: respect the minimum lead time.
    if (dayOffset === 0 && t < now.minutes + SITE.booking.minLeadMinutes) continue;

    // At least one candidate must be free for the whole duration.
    const someoneFree = candidates.some((b) => {
      const taken = takenByBarber.get(b.slug);
      for (let x = t; x < t + service.duration; x += step) {
        if (taken.has(x)) return false;
      }
      return true;
    });

    if (someoneFree) out.push(t);
  }
  return out;
}

function dayIsBookable(date) {
  if (!state.service) return false;
  return slotsFor(date, state.barber?.slug ?? 'any', state.service).length > 0;
}

/* ========================================================================
   Saved bookings
   ======================================================================== */

function savedBookings() {
  const all = store.get(BOOKINGS_KEY, []);
  if (!Array.isArray(all)) return [];
  const now = sastNow();
  // Drop anything in the past so the recall panel stays useful.
  return all.filter((b) => {
    if (!b || !b.dateKey) return false;
    const [y, m, d] = b.dateKey.split('-').map(Number);
    return daysBetween(now, { y, m, d }) >= 0;
  });
}

function saveBooking(entry) {
  const all = savedBookings();
  all.push(entry);
  all.sort((a, b) => (a.dateKey + a.time).localeCompare?.(b.dateKey + b.time) ?? 0);
  store.set(BOOKINGS_KEY, all);
}

/* ========================================================================
   Reference codes
   ======================================================================== */

function makeReference() {
  // No vowels, no 0/O/1/I — codes get read out over the phone.
  const alphabet = '23456789BCDFGHJKLMNPQRSTVWXYZ';
  const bytes = new Uint32Array(6);
  (window.crypto || window.msCrypto).getRandomValues(bytes);
  const body = [...bytes].map((n) => alphabet[n % alphabet.length]).join('');
  return `KB-${body}`;
}

/* ========================================================================
   Rendering
   ======================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function renderServices() {
  const host = $('[data-service-options]');
  if (!host) return;

  host.innerHTML = SITE.serviceGroups.map((group) => `
    <div class="optgroup">
      <h3 class="optgroup__title">${group.title}</h3>
      <div class="opts">
        ${group.services.map((s) => `
          <button class="opt${state.service?.slug === s.slug ? ' is-selected' : ''}"
                  type="button" data-pick-service="${s.slug}"
                  aria-pressed="${state.service?.slug === s.slug}">
            <img class="opt__thumb" src="./assets/img/${s.image}-640.jpg" alt=""
                 width="58" height="58" loading="lazy" decoding="async">
            <span class="opt__body">
              <span class="opt__name">${s.name}</span>
              <span class="opt__desc">${s.desc}</span>
              <span class="opt__meta">
                <span class="opt__price">${money(s.price)}</span>
                <span class="opt__dur">${durationLabel(s.duration)}</span>
              </span>
            </span>
          </button>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function renderBarbers() {
  const host = $('[data-barber-options]');
  if (!host) return;

  const cards = [ANY_BARBER, ...SITE.barbers];

  host.innerHTML = `
    <div class="opts opts--2">
      ${cards.map((b) => {
        const selected = state.barber?.slug === b.slug;
        const thumb = b.slug === 'any'
          ? `<span class="opt__thumb" aria-hidden="true" style="display:grid;place-content:center;background:var(--ink);color:var(--brass);font-family:var(--font-display);font-size:1.3rem">&#9733;</span>`
          : `<img class="opt__thumb" src="./assets/img/${b.image}-640.jpg" alt="" width="58" height="58" loading="lazy" decoding="async">`;
        const meta = b.slug === 'any'
          ? '<span class="opt__off">Gives you the widest choice of times</span>'
          : `<span class="opt__off">Off on ${b.dayOffName}s</span>`;
        return `
          <button class="opt${selected ? ' is-selected' : ''}" type="button"
                  data-pick-barber="${b.slug}" aria-pressed="${selected}">
            ${thumb}
            <span class="opt__body">
              <span class="opt__name">${b.name}</span>
              <span class="opt__desc">${b.slug === 'any' ? 'We&rsquo;ll put you with whoever is free at your chosen time.' : b.specialties.join(' &middot; ')}</span>
              ${meta}
            </span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderCalendar() {
  const host = $('[data-calendar]');
  if (!host || !state.viewMonth) return;

  const now = sastNow();
  const { y, m } = state.viewMonth;

  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  // Can we page backwards/forwards without leaving the bookable window?
  const prevDisabled = y === now.y && m === now.m;
  const maxDate = new Date(Date.UTC(now.y, now.m - 1, now.d) + SITE.booking.maxDaysAhead * 86400000);
  const nextDisabled =
    y > maxDate.getUTCFullYear() ||
    (y === maxDate.getUTCFullYear() && m >= maxDate.getUTCMonth() + 1);

  const cells = [];
  for (let i = 0; i < firstDow; i += 1) {
    cells.push('<span class="cal__day is-empty" aria-hidden="true"></span>');
  }

  for (let d = 1; d <= daysInMonth; d += 1) {
    const date = { y, m, d };
    const offset = daysBetween(now, date);
    const isToday = offset === 0;
    const selected = state.date && dateKey(state.date) === dateKey(date);

    const tooEarly = offset < 0;
    const tooLate = offset > SITE.booking.maxDaysAhead;
    const bookable = !tooEarly && !tooLate && dayIsBookable(date);

    const classes = ['cal__day'];
    if (selected) classes.push('is-selected');
    if (isToday) classes.push('is-today');

    const label = `${dayName(dowOf(date))} ${d} ${monthName(m)}`;
    const why = tooEarly ? 'in the past'
      : tooLate ? 'too far ahead'
      : 'fully booked or closed';

    cells.push(`
      <button class="${classes.join(' ')}" type="button"
              data-pick-day="${d}" ${bookable ? '' : 'disabled'}
              style="position:relative"
              aria-label="${label}${bookable ? '' : ` — ${why}`}"
              ${selected ? 'aria-current="date"' : ''}>${d}</button>
    `);
  }

  host.innerHTML = `
    <div class="cal__head">
      <p class="cal__month" aria-live="polite">${monthName(m)} ${y}</p>
      <div class="cal__nav">
        <button class="cal__btn" type="button" data-cal-prev ${prevDisabled ? 'disabled' : ''}
                aria-label="Previous month">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M10 2L4 8l6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="cal__btn" type="button" data-cal-next ${nextDisabled ? 'disabled' : ''}
                aria-label="Next month">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
    <div class="cal__dows" aria-hidden="true">
      ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        .map((d) => `<span class="cal__dow">${d}</span>`).join('')}
    </div>
    <div class="cal__grid" role="group" aria-label="Choose a date">${cells.join('')}</div>
    <div class="cal__key">
      <span class="cal__keyitem"><span class="cal__swatch" style="background:var(--brass)"></span>Selected</span>
      <span class="cal__keyitem"><span class="cal__swatch" style="border:1px solid var(--ink-line)"></span>Available</span>
      <span class="cal__keyitem"><span class="cal__swatch" style="background:var(--ink-line)"></span>Closed or full</span>
    </div>
  `;
}

function renderSlots() {
  const host = $('[data-slots]');
  if (!host) return;

  if (!state.date) {
    host.innerHTML = `
      <div class="empty">
        <strong>Pick a date first</strong>
        Choose a day on the calendar and we&rsquo;ll show you what&rsquo;s free.
      </div>`;
    return;
  }

  const slots = slotsFor(state.date, state.barber?.slug ?? 'any', state.service);

  if (!slots.length) {
    const dow = dowOf(state.date);
    const row = hoursFor(dow);
    const reason = row?.closed
      ? `We&rsquo;re closed on ${dayName(dow)}s.`
      : state.barber && state.barber.dayOff === dow
        ? `${state.barber.first} is off on ${dayName(dow)}s. Try another day, or pick &ldquo;Any available barber&rdquo;.`
        : 'Every slot that fits this service is taken. Try the next day.';
    host.innerHTML = `
      <div class="empty">
        <strong>Nothing free on ${formatShortDate(state.date)}</strong>
        ${reason}
      </div>`;
    return;
  }

  const groups = [
    { title: 'Morning', items: slots.filter((t) => t < 720) },
    { title: 'Afternoon', items: slots.filter((t) => t >= 720 && t < 1020) },
    { title: 'Evening', items: slots.filter((t) => t >= 1020) },
  ].filter((g) => g.items.length);

  host.innerHTML = `
    <div class="slots__head">
      <p class="slots__date">${formatLongDate(state.date)}</p>
      <p class="slots__count">${slots.length} time${slots.length === 1 ? '' : 's'} available &middot; ${durationLabel(state.service.duration)}</p>
    </div>
    ${groups.map((g) => `
      <div class="slotgroup">
        <p class="slotgroup__title">${g.title}</p>
        <div class="slots" role="group" aria-label="${g.title} times">
          ${g.items.map((t) => `
            <button class="slot${state.time === t ? ' is-selected' : ''}" type="button"
                    data-pick-time="${t}" aria-pressed="${state.time === t}"
                    aria-label="${formatTime12(t)} to ${formatTime12(t + state.service.duration)}">
              ${formatTime24(t)}
            </button>`).join('')}
        </div>
      </div>
    `).join('')}
  `;
}

function renderSummary() {
  const set = (key, value) => {
    const el = $(`[data-summary="${key}"]`);
    if (!el) return;
    el.textContent = value || 'Not chosen yet';
    el.classList.toggle('is-empty', !value);
  };

  set('service', state.service?.name);
  set('barber', state.barber?.name);
  set('date', state.date ? formatLongDate(state.date) : '');
  set(
    'time',
    state.time === null || !state.service
      ? ''
      : `${formatTime24(state.time)} – ${formatTime24(state.time + state.service.duration)}`
  );

  const total = $('[data-summary-total]');
  if (total) total.textContent = state.service ? money(state.service.price) : '—';

  const dur = $('[data-summary-duration]');
  if (dur) dur.textContent = state.service ? durationLabel(state.service.duration) : '';
}

function renderSteps() {
  $$('[data-steps] .steps__item').forEach((item, i) => {
    const n = i + 1;
    item.classList.toggle('is-current', n === state.step);
    item.classList.toggle('is-done', n < state.step);
    item.setAttribute('aria-current', n === state.step ? 'step' : 'false');
  });

  $$('[data-step]').forEach((panel) => {
    const active = Number(panel.dataset.step) === state.step;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  });
}

/* ========================================================================
   Navigation
   ======================================================================== */

function canAdvance(from) {
  if (from === 1) return Boolean(state.service);
  if (from === 2) return Boolean(state.barber);
  if (from === 3) return Boolean(state.date) && state.time !== null;
  return true;
}

function syncContinue() {
  $$('[data-next]').forEach((btn) => {
    const from = Number(btn.dataset.next);
    const ok = canAdvance(from);
    btn.disabled = !ok;
    btn.setAttribute('aria-disabled', String(!ok));
  });
}

function goTo(step, { focus = true } = {}) {
  state.step = Math.max(1, Math.min(STEP_COUNT, step));
  renderSteps();
  renderSummary();
  syncContinue();

  // On the confirmation step the running summary is redundant — the ticket
  // says everything — so give the confirmation the full width.
  const root = $('[data-booking]');
  const rail = $('[data-summary-rail]');
  if (root) root.classList.toggle('is-done', state.step === STEP_COUNT);
  if (rail) rail.hidden = state.step === STEP_COUNT;

  if (state.step === 3) {
    if (!state.viewMonth) {
      const now = sastNow();
      state.viewMonth = { y: now.y, m: now.m };
    }
    renderCalendar();
    renderSlots();
  }

  if (focus) {
    const panel = $(`[data-step="${state.step}"]`);
    const heading = panel?.querySelector('.step__title');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    const top = $('[data-book-top]');
    if (top) {
      const y = top.getBoundingClientRect().top + window.scrollY - 100;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  }
}

/* ========================================================================
   Validation
   ======================================================================== */

const VALIDATORS = {
  name: (v) => (v.trim().length >= 2 ? '' : 'Please tell us your name.'),
  email: (v) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())
      ? ''
      : 'That email address doesn&rsquo;t look right.',
  phone: (v) => {
    const digits = v.replace(/[\s()-]/g, '');
    return /^(\+27\d{9}|0\d{9})$/.test(digits)
      ? ''
      : 'Use a South African number, like 082 555 0147 or +27 82 555 0147.';
  },
};

function validateField(input) {
  const field = input.closest('.field') || input.closest('.checkline');
  if (!field) return true;

  let message = '';
  if (input.type === 'checkbox') {
    message = input.checked ? '' : 'Please accept the terms to continue.';
  } else {
    const rule = VALIDATORS[input.dataset.validate];
    message = rule ? rule(input.value) : '';
  }

  field.classList.toggle('has-error', Boolean(message));
  const slot = field.querySelector('.field__error');
  if (slot) slot.innerHTML = message;
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  return !message;
}

/* ========================================================================
   Confirmation
   ======================================================================== */

function bookingPayload() {
  return {
    parts: {
      y: state.date.y, m: state.date.m, d: state.date.d,
      hh: Math.floor(state.time / 60), mm: state.time % 60,
    },
    service: state.service,
    barber: state.barber,
    reference: state.reference,
    shop: SHOP,
  };
}

function renderConfirmation() {
  const host = $('[data-confirm]');
  if (!host) return;

  const endTime = state.time + state.service.duration;
  const barberLabel = state.barber.slug === 'any'
    ? 'First available barber'
    : `${state.barber.name} — ${state.barber.role}`;

  host.innerHTML = `
    <div class="confirm__tick" aria-hidden="true">
      <svg viewBox="0 0 28 28"><path d="M5 14.5l6 6L23 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>

    <h2 class="step__title confirm__title" tabindex="-1">You&rsquo;re booked in.</h2>
    <p class="confirm__lead">
      Thanks ${state.details.name.split(' ')[0]} — we&rsquo;ve got you down for
      ${formatTime12(state.time)} on ${formatLongDate(state.date)}. A confirmation
      is on its way to ${state.details.email}.
    </p>

    <span class="ref">
      <span class="ref__k">Booking reference</span>
      <span class="ref__v">${state.reference}</span>
    </span>

    <div class="ticket">
      <div class="ticket__head">
        <svg class="logomark" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
          <circle cx="60" cy="60" r="56" fill="none" stroke="var(--brass)" stroke-width="3"/>
          <g stroke="var(--bone)" stroke-width="7" stroke-linecap="square" fill="none">
            <path d="M47 38V82"/><path d="M47 60 69 38"/><path d="M47 60 71 82"/>
          </g>
        </svg>
        <span class="ticket__shop">${SITE.brand.name} BARBERING CO.</span>
      </div>
      <div class="ticket__body">
        <div class="ticket__row">
          <span class="ticket__k">When</span>
          <span class="ticket__v"><strong>${formatTime12(state.time)}</strong><br>${formatLongDate(state.date)}</span>
        </div>
        <div class="ticket__row">
          <span class="ticket__k">Service</span>
          <span class="ticket__v">${state.service.name}<br>
            <span style="color:var(--bone-faint);font-size:var(--t-xs)">
              ${formatTime24(state.time)}–${formatTime24(endTime)} &middot; ${durationLabel(state.service.duration)}
            </span>
          </span>
        </div>
        <div class="ticket__row">
          <span class="ticket__k">Barber</span>
          <span class="ticket__v">${barberLabel}</span>
        </div>
        <div class="ticket__row">
          <span class="ticket__k">Where</span>
          <span class="ticket__v">${SITE.contact.addressLine}<br>
            <span style="color:var(--bone-faint);font-size:var(--t-xs)">${SITE.contact.suburb}, ${SITE.contact.city}</span>
          </span>
        </div>
        <div class="ticket__row">
          <span class="ticket__k">Total</span>
          <span class="ticket__v"><strong>${money(state.service.price)}</strong><br>
            <span style="color:var(--bone-faint);font-size:var(--t-xs)">Payable in store</span>
          </span>
        </div>
      </div>
    </div>

    <div class="calcta">
      <p class="calcta__title">Add it to your calendar</p>
      <p class="calcta__lead">
        We&rsquo;ll set a reminder for an hour before, with the address and your
        reference attached.
      </p>
      <div class="calcta__btns" data-calendar-actions>
        <a class="calbtn" data-cal-google href="#" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V10h14zm0-12H5V6h14z"/></svg>
          Google Calendar
        </a>
        <button class="calbtn" type="button" data-cal-ics>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 3v10m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Apple / Outlook (.ics)
        </button>
        <a class="calbtn" data-cal-outlook href="#" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 5.5l9-1.8v16.6l-9-1.8zM13 6h8v12h-8zm-6.6 3.4c-1.2 0-2 1.1-2 2.6s.8 2.6 2 2.6 2-1.1 2-2.6-.8-2.6-2-2.6z"/></svg>
          Outlook Web
        </a>
      </div>
    </div>

    <div class="btnrow" style="margin-top:2rem;justify-content:center">
      <a class="btn btn--ghost" href="index.html">Back to home</a>
      <button class="btn btn--ghost" type="button" data-book-again>Book another appointment</button>
    </div>

    <p class="summary__note" style="margin-top:2rem">
      Need to change something? Call us on
      <a href="tel:${SITE.contact.phoneHref}" style="color:var(--brass)">${SITE.contact.phoneDisplay}</a>
      or WhatsApp
      <a href="https://wa.me/${SITE.contact.whatsappHref}" target="_blank" rel="noopener noreferrer" style="color:var(--brass)">${SITE.contact.whatsappDisplay}</a>
      at least 24 hours ahead. See our
      <a href="terms.html" style="color:var(--brass)">Terms &amp; Conditions</a>.
    </p>
  `;

  wireCalendarActions(host, bookingPayload());
  host.querySelector('.confirm__title')?.focus({ preventScroll: true });
}

function wireCalendarActions(root, payload) {
  const g = root.querySelector('[data-cal-google]');
  if (g) g.href = googleUrl(payload);

  const o = root.querySelector('[data-cal-outlook]');
  if (o) o.href = outlookUrl(payload);

  const ics = root.querySelector('[data-cal-ics]');
  if (ics) {
    ics.addEventListener('click', () => {
      const how = downloadIcs(payload);
      toast(
        how === 'ios'
          ? 'Opening the appointment in your calendar…'
          : `Downloaded ${icsFilename(payload)}`
      );
    });
  }
}

/* ========================================================================
   Saved bookings panel
   ======================================================================== */

function renderSaved() {
  const host = $('[data-saved]');
  if (!host) return;

  const list = savedBookings();
  if (!list.length) {
    host.hidden = true;
    return;
  }

  host.hidden = false;
  const body = host.querySelector('[data-saved-list]');
  body.innerHTML = list.map((b) => {
    const [y, m, d] = b.dateKey.split('-').map(Number);
    return `
      <div class="savedrow">
        <span class="savedrow__when">${formatShortDate({ y, m, d })} &middot; ${formatTime24(b.time)}</span>
        <span class="savedrow__what">${b.serviceName} with ${b.barberName}</span>
        <span class="savedrow__ref">${b.reference}</span>
        <span class="savedrow__acts">
          <button class="btn btn--ghost btn--sm" type="button" data-resend="${b.reference}">
            Add to calendar
          </button>
        </span>
      </div>`;
  }).join('');

  body.querySelectorAll('[data-resend]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const entry = list.find((x) => x.reference === btn.dataset.resend);
      if (!entry) return;
      const [y, m, d] = entry.dateKey.split('-').map(Number);
      const payload = {
        parts: { y, m, d, hh: Math.floor(entry.time / 60), mm: entry.time % 60 },
        service: findService(entry.serviceSlug) || {
          name: entry.serviceName, duration: entry.duration, price: entry.price,
        },
        barber: entry.barberSlug === 'any'
          ? ANY_BARBER
          : findBarber(entry.barberSlug) || { slug: entry.barberSlug, name: entry.barberName, first: entry.barberName },
        reference: entry.reference,
        shop: SHOP,
      };
      const how = downloadIcs(payload);
      toast(how === 'ios' ? 'Opening in your calendar…' : `Downloaded ${icsFilename(payload)}`);
    });
  });
}

/* ========================================================================
   Wiring
   ======================================================================== */

function applyDeepLinks() {
  const params = new URLSearchParams(window.location.search);

  const svc = params.get('service');
  if (svc) {
    const found = findService(svc);
    if (found) {
      state.service = found;
      state.step = 2;
    }
  }

  const barb = params.get('barber');
  if (barb) {
    const found = barb === 'any' ? ANY_BARBER : findBarber(barb);
    if (found) {
      state.barber = found;
      if (state.service) state.step = 3;
    }
  }

  const promo = store.get('kennys.promo', '');
  const promoHost = $('[data-promo-applied]');
  if (promo && promoHost) {
    promoHost.hidden = false;
    const codeEl = promoHost.querySelector('[data-promo-value]');
    if (codeEl) codeEl.textContent = promo;
  }
}

function resetForNewBooking() {
  state.service = null;
  state.barber = null;
  state.date = null;
  state.time = null;
  state.reference = null;
  state.viewMonth = null;
  state.details = { name: '', email: '', phone: '', notes: '' };
  $('[data-details-form]')?.reset();
  $$('.field.has-error, .checkline.has-error').forEach((f) => f.classList.remove('has-error'));
  renderServices();
  renderBarbers();
  renderSaved();
  goTo(1);
}

export function initBooking() {
  const root = $('[data-booking]');
  if (!root) return;

  applyDeepLinks();
  renderServices();
  renderBarbers();
  renderSaved();
  goTo(state.step, { focus: false });

  /* --- selection --------------------------------------------------------- */
  root.addEventListener('click', (e) => {
    const svcBtn = e.target.closest('[data-pick-service]');
    if (svcBtn) {
      state.service = findService(svcBtn.dataset.pickService);
      // Duration changed, so any held time may no longer fit.
      state.time = null;
      renderServices();
      renderSummary();
      syncContinue();
      return;
    }

    const barbBtn = e.target.closest('[data-pick-barber]');
    if (barbBtn) {
      const slug = barbBtn.dataset.pickBarber;
      state.barber = slug === 'any' ? ANY_BARBER : findBarber(slug);
      // A different barber has a different day off and different availability.
      state.time = null;
      if (state.date && !dayIsBookable(state.date)) state.date = null;
      renderBarbers();
      renderSummary();
      syncContinue();
      return;
    }

    const dayBtn = e.target.closest('[data-pick-day]');
    if (dayBtn && !dayBtn.disabled) {
      state.date = { y: state.viewMonth.y, m: state.viewMonth.m, d: Number(dayBtn.dataset.pickDay) };
      state.time = null;
      renderCalendar();
      renderSlots();
      renderSummary();
      syncContinue();
      return;
    }

    const timeBtn = e.target.closest('[data-pick-time]');
    if (timeBtn) {
      state.time = Number(timeBtn.dataset.pickTime);
      renderSlots();
      renderSummary();
      syncContinue();
      return;
    }

    /* --- calendar paging ------------------------------------------------- */
    if (e.target.closest('[data-cal-prev]')) {
      const { y, m } = state.viewMonth;
      state.viewMonth = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
      renderCalendar();
      return;
    }
    if (e.target.closest('[data-cal-next]')) {
      const { y, m } = state.viewMonth;
      state.viewMonth = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
      renderCalendar();
      return;
    }

    /* --- step navigation ------------------------------------------------- */
    const next = e.target.closest('[data-next]');
    if (next && !next.disabled) {
      goTo(Number(next.dataset.next) + 1);
      return;
    }
    const back = e.target.closest('[data-back]');
    if (back) {
      goTo(Number(back.dataset.back) - 1);
      return;
    }

    if (e.target.closest('[data-book-again]')) resetForNewBooking();
  });

  /* --- details form ------------------------------------------------------ */
  const form = $('[data-details-form]');
  if (form) {
    form.querySelectorAll('[data-validate], [name="terms"]').forEach((input) => {
      input.addEventListener('blur', () => validateField(input));
      input.addEventListener('input', () => {
        const field = input.closest('.field') || input.closest('.checkline');
        if (field?.classList.contains('has-error')) validateField(input);
      });
      input.addEventListener('change', () => {
        if (input.type === 'checkbox') validateField(input);
      });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const inputs = [...form.querySelectorAll('[data-validate], [name="terms"]')];
      const ok = inputs.map(validateField).every(Boolean);

      if (!ok) {
        const firstBad = form.querySelector('.has-error input, .has-error textarea');
        firstBad?.focus();
        toast('Please check the highlighted fields.');
        return;
      }

      const data = new FormData(form);
      state.details = {
        name: String(data.get('name') || '').trim(),
        email: String(data.get('email') || '').trim(),
        phone: String(data.get('phone') || '').trim(),
        notes: String(data.get('notes') || '').trim(),
      };
      state.reference = makeReference();

      saveBooking({
        reference: state.reference,
        dateKey: dateKey(state.date),
        time: state.time,
        duration: state.service.duration,
        price: state.service.price,
        serviceSlug: state.service.slug,
        serviceName: state.service.name,
        barberSlug: state.barber.slug,
        barberName: state.barber.slug === 'any' ? 'any available barber' : state.barber.first,
        name: state.details.name,
      });

      renderConfirmation();
      goTo(5, { focus: false });
      renderSaved();
      window.scrollTo({ top: $('[data-book-top]')?.offsetTop - 100 || 0, behavior: 'smooth' });
    });
  }
}
