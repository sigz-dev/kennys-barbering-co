/** Shared helpers. */

export const UTC_OFFSET_HOURS = 2; // SAST, no DST

/**
 * The current wall-clock time in Johannesburg, whatever timezone the visitor
 * is in. Reading UTC fields off a shifted timestamp avoids depending on the
 * browser's own locale or offset.
 */
export function sastNow() {
  const t = new Date(Date.now() + UTC_OFFSET_HOURS * 3600000);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    hh: t.getUTCHours(),
    mm: t.getUTCMinutes(),
    dow: t.getUTCDay(), // 0 = Sunday
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

/** Day of week for a plain {y,m,d}, timezone-independent. 0 = Sunday. */
export function dowOf({ y, m, d }) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whole days between two plain dates (b - a). */
export function daysBetween(a, b) {
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86400000);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const dayName = (dow) => DAY_NAMES[dow];
export const monthName = (m) => MONTH_NAMES[m - 1];

/** "Thursday, 2 October 2026" */
export function formatLongDate(parts) {
  return `${dayName(dowOf(parts))}, ${parts.d} ${monthName(parts.m)} ${parts.y}`;
}

/** "Thu 2 Oct" */
export function formatShortDate(parts) {
  return `${dayName(dowOf(parts)).slice(0, 3)} ${parts.d} ${monthName(parts.m).slice(0, 3)}`;
}

/** Minutes past midnight -> "3:00 PM" */
export function formatTime12(minutes) {
  const h24 = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${suffix}`;
}

/** Minutes past midnight -> "15:00" */
export function formatTime24(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "09:00" -> 540 */
export function parseHm(hm) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export function durationLabel(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  const hLabel = h === 1 ? '1 hr' : `${h} hrs`;
  return r ? `${hLabel} ${r} min` : hLabel;
}

/* ------------------------------------------------------------------ toast */

let toastTimer;

export function toast(message) {
  const el = document.querySelector('[data-toast]');
  if (!el) return;
  const text = el.querySelector('[data-toast-text]');
  if (text) text.textContent = message;
  el.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-shown'), 3600);
}

/* ---------------------------------------------------------------- storage */

/** localStorage can throw (private mode, blocked cookies). Never let it break a page. */
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch { /* ignore */ }
  },
};

/* ------------------------------------------------------------- focus trap */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapFocus(container, event) {
  const items = [...container.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
  if (!items.length) return;

  const first = items[0];
  const last = items[items.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function firstFocusable(container) {
  return container.querySelector(FOCUSABLE);
}
