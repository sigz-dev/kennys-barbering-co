/**
 * First-visit offer modal.
 *
 * Shown once per visitor, and never on the booking page — interrupting someone
 * halfway through booking is exactly the kind of popup people resent.
 */

import { store, toast, trapFocus, firstFocusable } from './util.js';

const SEEN_KEY = 'kennys.offerSeen';
const DELAY_MS = 6500;

export function initModal() {
  const modal = document.querySelector('[data-modal]');
  if (!modal) return;

  const card = modal.querySelector('.modal__card');
  let lastFocused = null;
  let armed = true;

  const open = () => {
    if (!armed) return;
    armed = false;
    lastFocused = document.activeElement;
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('is-open'));
    document.body.classList.add('is-locked');
    store.set(SEEN_KEY, true);
    firstFocusable(card)?.focus();
  };

  const close = () => {
    modal.classList.remove('is-open');
    document.body.classList.remove('is-locked');
    lastFocused?.focus?.();
    setTimeout(() => {
      if (!modal.classList.contains('is-open')) modal.hidden = true;
    }, 360);
  };

  modal.querySelectorAll('[data-modal-close]').forEach((btn) =>
    btn.addEventListener('click', close)
  );

  document.addEventListener('keydown', (e) => {
    if (!modal.classList.contains('is-open')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') trapFocus(card, e);
  });

  // Copy the promo code.
  modal.querySelector('[data-copy]')?.addEventListener('click', async (e) => {
    const code = e.currentTarget.dataset.copy;
    try {
      await navigator.clipboard.writeText(code);
      e.currentTarget.textContent = 'Copied';
      toast(`Code ${code} copied to your clipboard.`);
      setTimeout(() => { e.currentTarget.textContent = 'Copy'; }, 2200);
    } catch {
      // Clipboard can be blocked; the code is on screen either way.
      toast(`Your code is ${code}.`);
    }
  });

  // Carry the offer through to the booking page.
  modal.querySelector('[data-modal-book]')?.addEventListener('click', () => {
    store.set('kennys.promo', modal.querySelector('[data-promo-code]')?.textContent?.trim() || '');
    close();
  });

  /* --- when to show ------------------------------------------------------ */
  if (store.get(SEEN_KEY, false)) return;

  const timer = setTimeout(open, DELAY_MS);

  // Desktop exit-intent: pointer leaves through the top of the viewport.
  const onExit = (e) => {
    if (e.clientY <= 0 && armed) {
      clearTimeout(timer);
      open();
      document.removeEventListener('mouseout', onExit);
    }
  };
  if (window.matchMedia('(min-width: 1000px)').matches) {
    document.addEventListener('mouseout', onExit);
  }
}
