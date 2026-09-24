/** Entry point. Each module no-ops on pages that don't contain its markup. */

import { initNav } from './nav.js';
import { initReveal } from './reveal.js';
import { initHours } from './hours.js';
import { initModal } from './modal.js';
import { initBooking } from './booking.js';
import { initContact } from './contact.js';

function boot() {
  // Each is isolated: one failing feature must not take the page down with it.
  const features = [
    ['navigation', initNav],
    ['reveal', initReveal],
    ['hours', initHours],
    ['booking', initBooking],
    ['contact form', initContact],
    ['offer modal', initModal],
  ];

  features.forEach(([name, fn]) => {
    try {
      fn();
    } catch (err) {
      console.error(`[kennys] ${name} failed to start:`, err);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
