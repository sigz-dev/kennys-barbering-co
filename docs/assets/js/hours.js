/**
 * Live "Open now / Closed" state and today's-row highlighting.
 *
 * Computed against Johannesburg time, not the visitor's — a customer checking
 * from London should see whether the shop is open there, not here.
 */

import { SITE } from './site-data.js';
import { sastNow, parseHm, formatTime24, dayName } from './util.js';

const LAST_BOOKING_BUFFER = 45; // last appointment starts 45 min before close

function todayRow(now) {
  return SITE.hours.find((h) => h.dow === now.dow);
}

function nextOpening(now) {
  for (let step = 1; step <= 7; step += 1) {
    const dow = (now.dow + step) % 7;
    const row = SITE.hours.find((h) => h.dow === dow);
    if (row && !row.closed) {
      return { row, label: step === 1 ? 'tomorrow' : dayName(dow) };
    }
  }
  return null;
}

function computeState() {
  const now = sastNow();
  const today = todayRow(now);

  if (today && !today.closed) {
    const open = parseHm(today.open);
    const close = parseHm(today.close);

    if (now.minutes >= open && now.minutes < close) {
      const lastCall = close - LAST_BOOKING_BUFFER;
      if (now.minutes >= lastCall) {
        return { open: true, text: `Open &middot; last cut at ${formatTime24(lastCall)}` };
      }
      return { open: true, text: `Open now until ${formatTime24(close)}` };
    }

    if (now.minutes < open) {
      return { open: false, text: `Closed &middot; opens at ${formatTime24(open)}` };
    }
  }

  const next = nextOpening(now);
  return {
    open: false,
    text: next
      ? `Closed &middot; opens ${next.label} at ${next.row.open}`
      : 'Closed',
  };
}

export function initHours() {
  const badges = document.querySelectorAll('[data-openbadge]');
  const now = sastNow();

  if (badges.length) {
    const state = computeState();
    badges.forEach((badge) => {
      badge.classList.toggle('is-open', state.open);
      badge.classList.toggle('is-closed', !state.open);
      badge.innerHTML = state.text;
    });
  }

  // Mark today in every hours table on the page.
  document.querySelectorAll('[data-hours] .hours__row, [data-fhours] .fhours__row')
    .forEach((row) => {
      row.classList.toggle('is-today', Number(row.dataset.dow) === now.dow);
    });

  // Keep it honest if a tab is left open across an opening or closing time.
  if (badges.length) {
    setInterval(() => {
      const state = computeState();
      badges.forEach((badge) => {
        badge.classList.toggle('is-open', state.open);
        badge.classList.toggle('is-closed', !state.open);
        badge.innerHTML = state.text;
      });
    }, 60000);
  }
}
