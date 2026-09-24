/** Header scroll state and the mobile navigation overlay. */

import { trapFocus, firstFocusable } from './util.js';

export function initNav() {
  const header = document.querySelector('[data-header]');
  const burger = document.querySelector('[data-burger]');
  const panel = document.querySelector('[data-mobilenav]');
  if (!header) return;

  /* --- condense the header once the hero has scrolled past --------------- */
  const hasHero = Boolean(document.querySelector('.hero'));
  if (!hasHero) header.classList.add('is-solid');

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      header.classList.toggle('is-stuck', window.scrollY > 24);
      ticking = false;
    });
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* --- mobile overlay ---------------------------------------------------- */
  if (!burger || !panel) return;

  let lastFocused = null;

  const open = () => {
    lastFocused = document.activeElement;
    panel.hidden = false;
    // Next frame, so the transition has a starting state to animate from.
    requestAnimationFrame(() => panel.classList.add('is-open'));
    burger.setAttribute('aria-expanded', 'true');
    burger.setAttribute('aria-label', 'Close menu');
    document.body.classList.add('is-locked');
    firstFocusable(panel)?.focus();
  };

  const close = ({ restoreFocus = true } = {}) => {
    panel.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Open menu');
    document.body.classList.remove('is-locked');
    if (restoreFocus) (lastFocused || burger).focus();
    setTimeout(() => {
      if (!panel.classList.contains('is-open')) panel.hidden = true;
    }, 340);
  };

  const isOpen = () => burger.getAttribute('aria-expanded') === 'true';

  burger.addEventListener('click', () => (isOpen() ? close() : open()));

  panel.addEventListener('click', (e) => {
    if (e.target.closest('a')) close({ restoreFocus: false });
  });

  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') trapFocus(panel, e);
  });

  // Leaving the mobile breakpoint with the menu open would strand the lock.
  const wide = window.matchMedia('(min-width: 1000px)');
  wide.addEventListener('change', (e) => {
    if (e.matches && isOpen()) close({ restoreFocus: false });
  });
}
