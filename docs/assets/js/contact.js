/**
 * Contact page enquiry form.
 *
 * There's no mail server behind a static site, so rather than pretend, this
 * validates properly and then hands the message off to the customer's own mail
 * client with everything pre-filled — which actually reaches the shop.
 */

import { SITE } from './site-data.js';
import { toast } from './util.js';

const RULES = {
  name: (v) => (v.trim().length >= 2 ? '' : 'Please tell us your name.'),
  email: (v) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())
      ? ''
      : 'That email address doesn&rsquo;t look right.',
  message: (v) =>
    v.trim().length >= 10 ? '' : 'A little more detail helps us answer properly.',
};

function validate(input) {
  const field = input.closest('.field');
  if (!field) return true;
  const rule = RULES[input.dataset.validate];
  const message = rule ? rule(input.value) : '';
  field.classList.toggle('has-error', Boolean(message));
  const slot = field.querySelector('.field__error');
  if (slot) slot.innerHTML = message;
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  return !message;
}

export function initContact() {
  const form = document.querySelector('[data-contact-form]');
  if (!form) return;

  form.querySelectorAll('[data-validate]').forEach((input) => {
    input.addEventListener('blur', () => validate(input));
    input.addEventListener('input', () => {
      if (input.closest('.field')?.classList.contains('has-error')) validate(input);
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const inputs = [...form.querySelectorAll('[data-validate]')];
    if (!inputs.map(validate).every(Boolean)) {
      form.querySelector('.has-error input, .has-error textarea')?.focus();
      toast('Please check the highlighted fields.');
      return;
    }

    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const email = String(data.get('email') || '').trim();
    const phone = String(data.get('phone') || '').trim();
    const subject = String(data.get('subject') || 'Website enquiry');
    const message = String(data.get('message') || '').trim();

    const body = [
      message,
      '',
      '—',
      `Name:  ${name}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : null,
      '',
      'Sent from kennys.co.za',
    ].filter((l) => l !== null).join('\n');

    const href =
      `mailto:${SITE.contact.email}` +
      `?subject=${encodeURIComponent(`${subject} — ${name}`)}` +
      `&body=${encodeURIComponent(body)}`;

    window.location.href = href;

    const done = form.querySelector('[data-contact-done]');
    if (done) done.hidden = false;
    toast('Opening your email app with the message ready to send.');
  });
}
