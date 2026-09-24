# Kenny's Barbering Co.

Website for a fictional barbershop on Fourth Avenue, Parkhurst, Johannesburg.

**Live:** https://sigz-dev.github.io/kennys-barbering-co/

A hand-built static site — no framework, no CSS library, no runtime dependencies.
Nine pages, a working four-step booking flow, and real calendar integration.

---

## The brand

| | |
|---|---|
| **Name** | Kenny's Barbering Co. — *A cut above, since 1998.* |
| **Location** | Shop 4, 14 Fourth Avenue, Parkhurst, Johannesburg, 2193 |
| **Palette** | Charcoal `#0E0E10` · Brass `#C8A45C` · Bone `#F4F1EA` |
| **Type** | Fraunces (display) · Archivo (UI) — both self-hosted, variable |
| **Logo** | Hand-authored SVG monogram and seal (`src/partials/logo-*.svg`) |

The brass accent is only ever used on dark surfaces. Used on a light surface it
drops below AA contrast, so the rule is enforced by convention throughout.

---

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Hero, services preview, story, barbers, gallery, testimonials, hours |
| `services.html` | Full grouped price list; every row deep-links into booking |
| `about.html` | Shop history, timeline, values, four barber profiles |
| `gallery.html` | Three curated photo mosaics |
| `booking.html` | The booking flow + saved-appointments recall |
| `contact.html` | Address, hours, map, directions, enquiry form, FAQs |
| `terms.html` | Full Terms & Conditions (18 sections) |
| `privacy.html` | POPIA-aware Privacy Policy |
| `404.html` | On-brand not-found page |

---

## Booking

Four steps, then a confirmation: **service → barber → date & time → your details**.

Availability is computed for real, not faked:

- opening hours per weekday (closed Mondays)
- the selected service's duration must fit before closing time
- each barber has a fixed day off (Kenny Tue, Thabo Wed, Rea Thu, Ayanda Fri)
- slots already taken are removed; "Any available barber" frees up more times
- times earlier than an hour from now are hidden, computed in **Johannesburg
  time** — so a visitor booking from London still sees the shop's real day
- days with nothing free are greyed out in the calendar, with the reason
  announced to screen readers

Bookings persist to `localStorage`, so a slot you just took is genuinely gone
when you go back, and past appointments drop off the recall panel automatically.

### Calendar integration

The confirmation screen offers three routes, all generated from the customer's
actual selection:

1. **Google Calendar** — a `render?action=TEMPLATE` link with UTC timestamps.
2. **Apple / Outlook desktop** — a downloaded `.ics` file.
3. **Outlook Web** — a compose deeplink.

The shop is in `Africa/Johannesburg`, which is **UTC+2 all year with no daylight
saving**. A 3:00 PM booking therefore always produces `T130000Z`, in January and
in July alike.

The `.ics` is written to RFC 5545 properly, which is where most implementations
slip: CRLF line endings, folding at 75 **octets** (not characters, and never
mid-character), `,` `;` `\` and newlines escaped in TEXT values, a real
`VTIMEZONE` block so Apple Calendar places the event correctly regardless of the
device's own timezone, plus `UID`, `DTSTAMP`, `STATUS`, and a `VALARM` reminder
60 minutes before. iOS Safari ignores `download` on `blob:` URLs, so it gets a
`data:` URI instead and hands off to Calendar.

All of the above is covered by executable assertions — see Testing.

---

## Architecture

```
build.py              assembles src/ -> docs/ (no dependencies beyond stdlib)
src/
  data/site.json      single source of truth: services, barbers, hours, contact
  partials/           head, header, footer, offer modal, logo SVGs
  pages/              one template per page
docs/                 BUILD OUTPUT — this is what GitHub Pages serves
  assets/css/         site.css (authored) + fonts.css (generated)
  assets/js/          ES modules, no dependencies
  assets/img/         35 photographs x 3 widths
tests/                never deployed
```

`src/data/site.json` feeds both the HTML build *and* the booking engine — the
build emits `docs/assets/js/site-data.js` from the same file, so prices and
opening hours can never drift between the price list and the booking calendar.

**Why a build step at all:** nine pages share a header, footer and modal.
Maintaining those nine times is where consistency quietly dies. The output is
still plain static HTML.

**Every local path is relative** (`./assets/…`, `services.html`). GitHub Pages
project sites live at a subpath, so a root-absolute `/assets/…` would 404 in
production but work perfectly in local testing. `build.py` fails the build if
one appears.

### Rebuilding

```bash
python build.py                  # rebuild docs/ from src/
python -m http.server 8123 --directory docs
```

Assets are regenerated only when needed:

```bash
python tests/fetch_fonts.py      # self-host Fraunces + Archivo as woff2
python tests/build_images.py     # download, crop, grade, write 3 widths each
python tests/build_brand.py      # PWA icons + per-page Open Graph cards
```

---

## Testing

```bash
npm test          # links + calendar + journey + accessibility
npm run shots     # screenshot every page at desktop and mobile
```

| Suite | Covers |
|---|---|
| `tests/link_audit.py` | Every local `href`/`src`/`srcset` resolves; every anchor has a matching `id`; no root-absolute paths; no unresolved template tokens; all three image widths present |
| `tests/calendar.test.mjs` | **60 assertions** on timezone maths, ICS structure, RFC 5545 escaping and folding, and the Google/Outlook links |
| `tests/journey.mjs` | **89 assertions** driving the real browser through Home → Services → Booking → calendar download, plus validation, re-booking, the modal and the mobile nav |
| `tests/a11y.mjs` | axe-core against WCAG 2.1 A/AA across 9 pages **and** 6 interactive states (modal open, each booking step, mobile nav open) |
| `tests/shots.mjs` | Screenshots + console errors + failed requests + horizontal overflow + undecoded images |

All suites pass. Node is required only for the tests — the site itself ships no
JavaScript dependencies.

---

## Accessibility & performance

- No WCAG 2.1 A/AA violations in any page or interactive state
- Skip-to-content link; visible brass focus rings throughout
- Modal and mobile nav trap focus, close on Escape, restore focus, lock scroll
- Every animation disabled under `prefers-reduced-motion`
- All images carry explicit `width`/`height` (no layout shift) and `srcset`
- Fonts self-hosted and preloaded — no third-party request on the critical path
- No cookies, no analytics, no trackers
- Booking degrades to a phone number and a full price list without JavaScript

## SEO

Per-page title, description, canonical, Open Graph and Twitter cards with
generated share images; `HairSalon` JSON-LD carrying address, geo, opening hours
and the full service catalogue; `FAQPage` JSON-LD on Contact; `sitemap.xml`,
`robots.txt` and a web manifest.

---

## Credits

Photography from [Unsplash](https://unsplash.com) under the Unsplash License,
colour-graded to a single palette so images from different shoots read as one
brand. Source photo IDs are listed in `tests/build_images.py`.

Typefaces: [Fraunces](https://fonts.google.com/specimen/Fraunces) and
[Archivo](https://fonts.google.com/specimen/Archivo), both SIL Open Font
License 1.1.

Map tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

> Kenny's Barbering Co. is a fictional business created for this project. The
> address, phone numbers, registration number, barbers and testimonials are
> invented. People pictured are Unsplash models, not the named barbers.
