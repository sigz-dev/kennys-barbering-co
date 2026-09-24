/** Subtle reveal-on-scroll. Disabled entirely when reduced motion is preferred. */

export function initReveal() {
  const items = document.querySelectorAll('.reveal');
  if (!items.length) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.06 }
  );

  items.forEach((el, i) => {
    // A short stagger reads as intentional rather than mechanical.
    el.style.transitionDelay = `${Math.min(i % 6, 5) * 55}ms`;
    io.observe(el);
  });
}
