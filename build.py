#!/usr/bin/env python3
"""
Static site builder for Kenny's Barbering Co.

Assembles src/pages + src/partials into plain static HTML in docs/.
No dependencies beyond the standard library.

    python build.py

Why a build step: the site has 9 pages sharing a header, footer and modal.
Hand-maintaining those nine times is where consistency quietly dies. The
*output* is still pure static HTML -- GitHub Pages just serves files.
"""

import json
import re
import shutil
import sys
from datetime import date
from html import escape
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src"
OUT = ROOT / "docs"
YEAR = 2026

# --------------------------------------------------------------------------
# Page registry -- slug, nav label, and per-page SEO
# --------------------------------------------------------------------------

PAGES = [
    {
        "slug": "index",
        "nav": "Home",
        "in_nav": False,
        "title": "Kenny's Barbering Co. | Barbershop in Parkhurst, Johannesburg",
        "desc": "A four-chair barbershop on Fourth Avenue, Parkhurst. Cuts, skin fades, beard sculpting and traditional hot towel shaves since 1998. Book your chair online.",
        "og": "og-home",
    },
    {
        "slug": "services",
        "nav": "Services",
        "in_nav": True,
        "title": "Services & Prices | Kenny's Barbering Co.",
        "desc": "Cuts from R180, skin fades, beard sculpting, hot towel shaves and packages. Full price list and durations for our Parkhurst barbershop.",
        "og": "og-services",
    },
    {
        "slug": "about",
        "nav": "About",
        "in_nav": True,
        "title": "Our Story & Barbers | Kenny's Barbering Co.",
        "desc": "Twenty-eight years on Fourth Avenue. Meet Kenny, Thabo, Rea and Ayanda, and read how a one-chair shop became a Parkhurst institution.",
        "og": "og-about",
    },
    {
        "slug": "gallery",
        "nav": "Gallery",
        "in_nav": True,
        "title": "Our Work | Kenny's Barbering Co.",
        "desc": "A look at the cuts, fades, beard work and the shop itself. Photographed on the floor at Kenny's Barbering Co. in Parkhurst.",
        "og": "og-gallery",
    },
    {
        "slug": "contact",
        "nav": "Contact",
        "in_nav": True,
        "title": "Contact & Find Us | Kenny's Barbering Co.",
        "desc": "Shop 4, 14 Fourth Avenue, Parkhurst, Johannesburg. Opening hours, directions, parking, phone and WhatsApp. Open Tuesday to Sunday.",
        "og": "og-contact",
    },
    {
        "slug": "booking",
        "nav": "Book",
        "in_nav": False,
        "title": "Book an Appointment | Kenny's Barbering Co.",
        "desc": "Book your chair in four steps. Choose a service, pick your barber, select a date and time, and add the appointment straight to your calendar.",
        "og": "og-booking",
    },
    {
        "slug": "terms",
        "nav": "Terms",
        "in_nav": False,
        "title": "Terms & Conditions | Kenny's Barbering Co.",
        "desc": "Booking, cancellation, lateness and no-show policy, our redo guarantee, gift vouchers and the terms that apply to appointments at Kenny's Barbering Co.",
        "og": "og-home",
    },
    {
        "slug": "privacy",
        "nav": "Privacy",
        "in_nav": False,
        "title": "Privacy Policy | Kenny's Barbering Co.",
        "desc": "How Kenny's Barbering Co. collects, uses and protects your personal information, in line with South Africa's POPIA.",
        "og": "og-home",
    },
    {
        "slug": "404",
        "nav": "404",
        "in_nav": False,
        "title": "Page Not Found | Kenny's Barbering Co.",
        "desc": "That page has had a bit too much off the top. Here's the way back.",
        "og": "og-home",
        "noindex": True,
    },
]

NAV = [p for p in PAGES if p["in_nav"]]


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def money(site, amount):
    return f"{site['contact']['currencySymbol']}{amount}"


def duration_label(mins):
    if mins < 60:
        return f"{mins} min"
    hours, rem = divmod(mins, 60)
    if rem == 0:
        return f"{hours} hr" if hours == 1 else f"{hours} hrs"
    return f"{hours} hr {rem} min"


def img(site, name, alt, sizes, cls="", width=1200, height=800,
        eager=False, position=None):
    """Responsive <img> with srcset, explicit dimensions and lazy loading."""
    srcset = ", ".join(
        f"./assets/img/{name}-{w}.jpg {w}w" for w in (640, 1280, 1920)
    )
    loading = "" if eager else ' loading="lazy" decoding="async"'
    priority = ' fetchpriority="high" decoding="async"' if eager else ""
    style = f' style="object-position:{position}"' if position else ""
    cls_attr = f' class="{cls}"' if cls else ""
    return (
        f'<img src="./assets/img/{name}-1280.jpg" srcset="{srcset}" '
        f'sizes="{sizes}" alt="{escape(alt)}" width="{width}" height="{height}"'
        f'{cls_attr}{loading}{priority}{style}>'
    )


def all_services(site):
    for group in site["serviceGroups"]:
        for svc in group["services"]:
            yield group, svc


def find_service(site, slug):
    for _, svc in all_services(site):
        if svc["slug"] == slug:
            return svc
    raise KeyError(slug)


# --------------------------------------------------------------------------
# Generated blocks -- each returns an HTML string from site.json
# --------------------------------------------------------------------------

def gen_nav_links(site, page):
    out = []
    for p in NAV:
        current = ' aria-current="page"' if p["slug"] == page["slug"] else ""
        active = " is-active" if p["slug"] == page["slug"] else ""
        out.append(
            f'<li><a class="nav__link{active}" href="{p["slug"]}.html"{current}>'
            f'{p["nav"]}</a></li>'
        )
    return "\n          ".join(out)


def gen_mobile_nav_links(site, page):
    out = []
    for i, p in enumerate(NAV, start=1):
        current = ' aria-current="page"' if p["slug"] == page["slug"] else ""
        active = " is-active" if p["slug"] == page["slug"] else ""
        out.append(
            f'<li class="mobilenav__item"><a class="mobilenav__link{active}" '
            f'href="{p["slug"]}.html"{current}>'
            f'<span class="mobilenav__num">0{i}</span>{p["nav"]}</a></li>'
        )
    return "\n            ".join(out)


def gen_footer_nav(site, page):
    links = [(p["nav"], f'{p["slug"]}.html') for p in NAV]
    links.insert(0, ("Home", "index.html"))
    links.append(("Book Now", "booking.html"))
    return "\n            ".join(
        f'<li><a href="{href}">{label}</a></li>' for label, href in links
    )


def gen_hours_rows(site, page):
    rows = []
    for h in site["hours"]:
        if h["closed"]:
            val = '<span class="hours__closed">Closed</span>'
        else:
            val = f'{h["open"]} &ndash; {h["close"]}'
        rows.append(
            f'<div class="hours__row" data-dow="{h["dow"]}">'
            f'<span class="hours__day">{h["day"]}</span>'
            f'<span class="hours__time">{val}</span></div>'
        )
    return "\n            ".join(rows)


def gen_hours_rows_compact(site, page):
    rows = []
    for h in site["hours"]:
        val = "Closed" if h["closed"] else f'{h["open"]}&ndash;{h["close"]}'
        cls = ' class="is-closed"' if h["closed"] else ""
        rows.append(
            f'<div class="fhours__row" data-dow="{h["dow"]}">'
            f'<span>{h["short"]}</span><span{cls}>{val}</span></div>'
        )
    return "\n              ".join(rows)


def gen_social_links(site, page):
    icons = {
        "Instagram": '<path d="M12 2.2c3.2 0 3.6 0 4.9.07 1.2.06 1.8.25 2.2.42.6.22 1 .48 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c0 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2 0-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2-.1-1.3-.1-1.7-.1-4.9s0-3.6.1-4.9c0-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zm0 1.8c-3.1 0-3.5 0-4.7.07-1.1.05-1.7.24-2.1.4-.5.2-.9.44-1.3.84-.4.4-.64.8-.84 1.3-.16.4-.35 1-.4 2.1C2.6 9.9 2.6 10.3 2.6 13.4s0 3.5.06 4.7c.05 1.1.24 1.7.4 2.1.2.5.44.9.84 1.3.4.4.8.64 1.3.84.4.16 1 .35 2.1.4 1.2.06 1.6.06 4.7.06s3.5 0 4.7-.06c1.1-.05 1.7-.24 2.1-.4.5-.2.9-.44 1.3-.84.4-.4.64-.8.84-1.3.16-.4.35-1 .4-2.1.06-1.2.06-1.6.06-4.7s0-3.5-.06-4.7c-.05-1.1-.24-1.7-.4-2.1-.2-.5-.44-.9-.84-1.3-.4-.4-.8-.64-1.3-.84-.4-.16-1-.35-2.1-.4C15.5 4 15.1 4 12 4z"/><path d="M12 7.1a4.9 4.9 0 100 9.8 4.9 4.9 0 000-9.8zm0 8.08a3.18 3.18 0 110-6.36 3.18 3.18 0 010 6.36z"/><circle cx="17.1" cy="6.9" r="1.15"/>',
        "Facebook": '<path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5h1.65V3.62A22 22 0 0014.3 3.5c-2.4 0-4 1.45-4 4.12V9.9H7.6V13h2.7v8z"/>',
        "TikTok": '<path d="M16.6 5.82A4.28 4.28 0 0115.54 3h-3.1v12.4a2.59 2.59 0 01-2.6 2.5 2.6 2.6 0 01-2.6-2.6 2.6 2.6 0 013.3-2.5v-3.13a5.7 5.7 0 00-6.4 5.63A5.7 5.7 0 009.84 21a5.7 5.7 0 005.7-5.7V9.01a7.35 7.35 0 004.3 1.38v-3.1a4.3 4.3 0 01-3.24-1.47z"/>',
    }
    out = []
    for s in site["social"]:
        out.append(
            f'<a class="social" href="{s["url"]}" target="_blank" '
            f'rel="noopener noreferrer" aria-label="{s["name"]}: {escape(s["handle"])} '
            f'(opens in a new tab)" title="{s["name"]}">'
            f'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
            f'{icons[s["name"]]}</svg></a>'
        )
    wa = site["contact"]
    out.append(
        f'<a class="social" href="https://wa.me/{wa["whatsappHref"]}" '
        f'target="_blank" rel="noopener noreferrer" '
        f'aria-label="WhatsApp us on {wa["whatsappDisplay"]} (opens in a new tab)" '
        f'title="WhatsApp">'
        f'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
        f'<path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15s-.76.96-.94 1.16c-.17.2-.34.22-.63.08a8.1 8.1 0 01-2.4-1.48 9 9 0 01-1.66-2.06c-.17-.3 0-.45.13-.6.13-.13.3-.34.44-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.48-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.26.3-1.03 1-1.03 2.45s1.06 2.85 1.2 3.05c.16.2 2.08 3.18 5.04 4.46.7.3 1.25.48 1.68.62.7.22 1.35.2 1.86.12.57-.09 1.75-.72 2-1.41.24-.7.24-1.28.17-1.41-.07-.13-.27-.2-.56-.35z"/><path d="M12.04 2a9.9 9.9 0 00-8.5 14.94L2 22.1l5.3-1.39A9.9 9.9 0 1012.04 2zm0 1.8a8.1 8.1 0 11-4.12 15.08l-.3-.18-3.14.82.84-3.06-.2-.31A8.1 8.1 0 0112.04 3.8z"/>'
        f'</svg></a>'
    )
    return "\n            ".join(out)


def gen_services_full(site, page):
    """Full grouped price list for the Services page."""
    blocks = []
    for group in site["serviceGroups"]:
        rows = []
        for svc in group["services"]:
            saving = (
                f'<span class="pricerow__save">Save {money(site, svc["saving"])}</span>'
                if svc.get("saving") else ""
            )
            popular = (
                '<span class="tag tag--brass">Most booked</span>'
                if svc.get("popular") else ""
            )
            rows.append(f"""
            <article class="pricerow reveal">
              <div class="pricerow__body">
                <h3 class="pricerow__name">{svc["name"]} {popular}</h3>
                <p class="pricerow__desc">{svc["desc"]}</p>
                <p class="pricerow__meta">
                  <span class="pricerow__dur">{duration_label(svc["duration"])}</span>
                  {saving}
                </p>
              </div>
              <div class="pricerow__tail">
                <p class="pricerow__price">{money(site, svc["price"])}</p>
                <a class="btn btn--ghost btn--sm" href="booking.html?service={svc["slug"]}">
                  Book<span class="u-sr-only"> {svc["name"]}</span>
                  <svg class="btn__arrow" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M1 8h13M9 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </a>
              </div>
            </article>""")
        blocks.append(f"""
        <section class="pricegroup" id="{group["id"]}" aria-labelledby="{group["id"]}-h">
          <header class="pricegroup__head reveal">
            <h2 class="pricegroup__title" id="{group["id"]}-h">{group["title"]}</h2>
            <p class="pricegroup__blurb">{group["blurb"]}</p>
          </header>
          <div class="pricegroup__rows">{"".join(rows)}
          </div>
        </section>""")
    return "".join(blocks)


def gen_services_preview(site, page):
    """Six highlighted service cards for the Home page."""
    picks = [
        "signature-cut", "skin-fade", "beard-sculpt",
        "hot-towel-shave", "the-full-service", "kids-cut",
    ]
    cards = []
    for slug in picks:
        svc = find_service(site, slug)
        badge = (
            '<span class="scard__badge">Most booked</span>'
            if svc.get("popular") else ""
        )
        cards.append(f"""
          <article class="scard reveal">
            <div class="scard__media">
              {img(site, svc["image"], f'{svc["name"]} at Kenny\'s Barbering Co.',
                   "(max-width: 640px) 90vw, (max-width: 1080px) 45vw, 30vw",
                   cls="scard__img", width=800, height=600)}
              {badge}
            </div>
            <div class="scard__body">
              <h3 class="scard__name">{svc["name"]}</h3>
              <p class="scard__desc">{svc["desc"]}</p>
              <p class="scard__meta">
                <span class="scard__price">{money(site, svc["price"])}</span>
                <span class="scard__dot" aria-hidden="true">&middot;</span>
                <span class="scard__dur">{duration_label(svc["duration"])}</span>
              </p>
              <a class="scard__link" href="booking.html?service={svc["slug"]}">
                Book this<span class="u-sr-only"> &ndash; {svc["name"]}</span>
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M1 8h13M9 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </a>
            </div>
          </article>""")
    return "".join(cards)


def gen_barber_cards(site, page):
    """Full barber profiles for the About page."""
    cards = []
    for b in site["barbers"]:
        specs = "".join(
            f'<li class="spec">{s}</li>' for s in b["specialties"]
        )
        cards.append(f"""
        <article class="barber reveal" id="{b["slug"]}">
          <div class="barber__media">
            {img(site, b["image"], f'{b["name"]}, {b["role"]} at Kenny\'s Barbering Co.',
                 "(max-width: 860px) 90vw, 42vw", cls="barber__img",
                 width=800, height=1000)}
          </div>
          <div class="barber__body">
            <p class="eyebrow">{b["role"]}</p>
            <h3 class="barber__name">{b["name"]}</h3>
            <p class="barber__years">{b["years"]} years behind the chair</p>
            <p class="barber__bio">{b["bio"]}</p>
            <blockquote class="barber__quote">{b["quote"]}</blockquote>
            <ul class="specs" aria-label="{b["first"]}'s specialities">{specs}</ul>
            <p class="barber__off">In the shop every day except <strong>{b["dayOffName"]}</strong></p>
            <a class="btn btn--ghost btn--sm" href="booking.html?barber={b["slug"]}">
              Book with {b["first"]}
              <svg class="btn__arrow" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M1 8h13M9 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </a>
          </div>
        </article>""")
    return "".join(cards)


def gen_barber_strip(site, page):
    """Compact barber cards for the Home page."""
    cards = []
    for b in site["barbers"]:
        cards.append(f"""
          <article class="bcard reveal">
            <div class="bcard__media">
              {img(site, b["image"], f'{b["name"]}, {b["role"]}',
                   "(max-width: 640px) 80vw, (max-width: 1080px) 40vw, 23vw",
                   cls="bcard__img", width=600, height=750)}
            </div>
            <h3 class="bcard__name">{b["name"]}</h3>
            <p class="bcard__role">{b["role"]}</p>
            <p class="bcard__spec">{b["specialties"][0]}</p>
            <a class="bcard__link" href="booking.html?barber={b["slug"]}">Book with {b["first"]}</a>
          </article>""")
    return "".join(cards)


def gen_testimonials(site, page):
    items = []
    for t in site["testimonials"]:
        items.append(f"""
          <figure class="quote reveal">
            <svg class="quote__mark" viewBox="0 0 32 24" aria-hidden="true" focusable="false"><path d="M13 24V13.2C13 5.9 17.4 1.3 25 0l1.6 3.4c-4.3 1-6.6 3.4-6.9 7h6.6V24zm-13 0V13.2C0 5.9 4.4 1.3 12 0l1.6 3.4c-4.3 1-6.6 3.4-6.9 7h6.6V24z" fill="currentColor"/></svg>
            <blockquote class="quote__text">{t["quote"]}</blockquote>
            <figcaption class="quote__by">
              <span class="quote__name">{t["name"]}</span>
              <span class="quote__meta">{t["meta"]}</span>
            </figcaption>
          </figure>""")
    return "".join(items)


def gen_faqs(site, page):
    items = []
    for i, f in enumerate(site["faqs"]):
        items.append(f"""
          <details class="faq reveal" name="faq"{" open" if i == 0 else ""}>
            <summary class="faq__q">
              <span>{f["q"]}</span>
              <svg class="faq__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 1v14M1 8h14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </summary>
            <div class="faq__a"><p>{f["a"]}</p></div>
          </details>""")
    return "".join(items)


def gen_values(site, page):
    items = []
    for i, v in enumerate(site["values"], start=1):
        items.append(f"""
          <article class="value reveal">
            <p class="value__num">0{i}</p>
            <h3 class="value__title">{v["title"]}</h3>
            <p class="value__body">{v["body"]}</p>
          </article>""")
    return "".join(items)


def gen_timeline(site, page):
    items = []
    for t in site["timeline"]:
        items.append(f"""
          <li class="tl__item reveal">
            <span class="tl__year">{t["year"]}</span>
            <div class="tl__body">
              <h3 class="tl__title">{t["title"]}</h3>
              <p class="tl__text">{t["body"]}</p>
            </div>
          </li>""")
    return "".join(items)


def gen_noscript_services(site, page):
    """Readable price list shown if JavaScript is unavailable on booking.html."""
    rows = []
    for group, svc in all_services(site):
        rows.append(
            f'<li><strong>{svc["name"]}</strong> &mdash; {money(site, svc["price"])}, '
            f'{duration_label(svc["duration"])}</li>'
        )
    return "\n              ".join(rows)


def gen_json_ld(site, page):
    c = site["contact"]
    spec = []
    for h in site["hours"]:
        if h["closed"]:
            continue
        spec.append({
            "@type": "OpeningHoursSpecification",
            "dayOfWeek": f"https://schema.org/{h['day']}",
            "opens": h["open"],
            "closes": h["close"],
        })
    offers = []
    for group, svc in all_services(site):
        offers.append({
            "@type": "Offer",
            "itemOffered": {
                "@type": "Service",
                "name": svc["name"],
                "description": svc["desc"],
                "category": group["title"],
            },
            "price": str(svc["price"]),
            "priceCurrency": c["currency"],
        })
    data = {
        "@context": "https://schema.org",
        "@type": "HairSalon",
        "@id": site["brand"]["baseUrl"] + "#shop",
        "name": site["brand"]["legalName"],
        "alternateName": "Kenny's",
        "description": PAGES[0]["desc"],
        "url": site["brand"]["baseUrl"],
        "telephone": c["phoneHref"],
        "email": c["email"],
        "priceRange": "R120 - R580",
        "currenciesAccepted": c["currency"],
        "paymentAccepted": "Cash, Credit Card, Debit Card, SnapScan, Zapper",
        "foundingDate": site["brand"]["established"],
        "image": site["brand"]["baseUrl"] + "assets/img/og-home.jpg",
        "logo": site["brand"]["baseUrl"] + "assets/logo/logo-seal.svg",
        "address": {
            "@type": "PostalAddress",
            "streetAddress": c["addressLine"],
            "addressLocality": c["suburb"],
            "addressRegion": c["province"],
            "postalCode": c["postalCode"],
            "addressCountry": c["countryCode"],
        },
        "geo": {"@type": "GeoCoordinates", "latitude": c["lat"], "longitude": c["lon"]},
        "openingHoursSpecification": spec,
        "hasOfferCatalog": {
            "@type": "OfferCatalog",
            "name": "Barbering services",
            "itemListElement": offers,
        },
        "sameAs": [s["url"] for s in site["social"]],
        "potentialAction": {
            "@type": "ReserveAction",
            "target": {
                "@type": "EntryPoint",
                "urlTemplate": site["brand"]["baseUrl"] + "booking.html",
                "actionPlatform": [
                    "https://schema.org/DesktopWebPlatform",
                    "https://schema.org/MobileWebPlatform",
                ],
            },
            "result": {"@type": "Reservation", "name": "Barbershop appointment"},
        },
    }
    return json.dumps(data, indent=2, ensure_ascii=False)


def gen_faq_json_ld(site, page):
    data = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": f["q"],
                "acceptedAnswer": {"@type": "Answer", "text": f["a"]},
            }
            for f in site["faqs"]
        ],
    }
    return json.dumps(data, indent=2, ensure_ascii=False)


GENERATORS = {
    "nav_links": gen_nav_links,
    "mobile_nav_links": gen_mobile_nav_links,
    "footer_nav": gen_footer_nav,
    "hours_rows": gen_hours_rows,
    "hours_rows_compact": gen_hours_rows_compact,
    "social_links": gen_social_links,
    "services_full": gen_services_full,
    "services_preview": gen_services_preview,
    "barber_cards": gen_barber_cards,
    "barber_strip": gen_barber_strip,
    "testimonials": gen_testimonials,
    "faqs": gen_faqs,
    "values": gen_values,
    "timeline": gen_timeline,
    "noscript_services": gen_noscript_services,
    "json_ld": gen_json_ld,
    "faq_json_ld": gen_faq_json_ld,
}


# --------------------------------------------------------------------------
# Template engine -- {{> partial }} includes, then {{ token }} substitution
# --------------------------------------------------------------------------

INCLUDE_RE = re.compile(r"\{\{>\s*([a-z0-9_-]+)\s*\}\}")
# Token names are camelCase (brand.legalName), so uppercase must match too —
# a lowercase-only class silently leaves those tokens in the output.
TOKEN_RE = re.compile(r"\{\{\s*([A-Za-z0-9_.]+)\s*\}\}")


def read(path):
    return path.read_text(encoding="utf-8")


def resolve_includes(text, depth=0):
    if depth > 6:
        raise RuntimeError("Include nesting too deep -- is a partial including itself?")

    def sub(m):
        name = m.group(1)
        part = SRC / "partials" / f"{name}.html"
        if not part.exists():
            part = SRC / "partials" / f"{name}.svg"
        if not part.exists():
            raise FileNotFoundError(f"Missing partial: {name}")
        return resolve_includes(read(part), depth + 1)

    return INCLUDE_RE.sub(sub, text)


def build_vars(site, page):
    c = site["contact"]
    b = site["brand"]
    canonical = b["baseUrl"] + ("" if page["slug"] == "index" else f'{page["slug"]}.html')
    return {
        "page.title": page["title"],
        "page.desc": page["desc"],
        "page.slug": page["slug"],
        "page.canonical": canonical,
        "page.og": page.get("og", "og-home"),
        "page.robots": "noindex, follow" if page.get("noindex") else "index, follow",
        "brand.name": b["name"],
        "brand.legalName": b["legalName"],
        "brand.tagline": b["tagline"],
        "brand.established": b["established"],
        "brand.baseUrl": b["baseUrl"],
        "contact.addressLine": c["addressLine"],
        "contact.suburb": c["suburb"],
        "contact.city": c["city"],
        "contact.postalCode": c["postalCode"],
        "contact.addressFull": c["addressFull"],
        "contact.phoneDisplay": c["phoneDisplay"],
        "contact.phoneHref": c["phoneHref"],
        "contact.whatsappDisplay": c["whatsappDisplay"],
        "contact.whatsappHref": c["whatsappHref"],
        "contact.email": c["email"],
        "contact.lat": str(c["lat"]),
        "contact.lon": str(c["lon"]),
        "offer.code": site["offer"]["code"],
        "offer.title": site["offer"]["title"],
        "offer.body": site["offer"]["body"],
        "offer.eyebrow": site["offer"]["eyebrow"],
        "offer.terms": site["offer"]["terms"],
        "year": str(YEAR),
    }


def render(page, site):
    tpl = read(SRC / "pages" / f'{page["slug"]}.html')
    tpl = resolve_includes(tpl)
    variables = build_vars(site, page)

    def sub(m):
        key = m.group(1)
        if key in GENERATORS:
            return GENERATORS[key](site, page)
        if key in variables:
            return variables[key]
        raise KeyError(f'Unknown token {{{{ {key} }}}} in page "{page["slug"]}"')

    return TOKEN_RE.sub(sub, tpl)


# --------------------------------------------------------------------------
# Side files
# --------------------------------------------------------------------------

def write_site_data(site):
    """Emit the booking engine's data module from the same source of truth."""
    payload = {
        "brand": site["brand"],
        "contact": site["contact"],
        "hours": site["hours"],
        "serviceGroups": site["serviceGroups"],
        "barbers": [
            {
                "slug": b["slug"], "name": b["name"], "first": b["first"],
                "role": b["role"], "image": b["image"], "dayOff": b["dayOff"],
                "dayOffName": b["dayOffName"], "specialties": b["specialties"],
            }
            for b in site["barbers"]
        ],
        "booking": site["booking"],
        "offer": site["offer"],
    }
    body = json.dumps(payload, indent=2, ensure_ascii=False)
    out = (
        "/* Generated by build.py from src/data/site.json -- do not edit by hand. */\n"
        f"export const SITE = {body};\n\n"
        "export const SERVICES = SITE.serviceGroups.flatMap((g) =>\n"
        "  g.services.map((s) => ({ ...s, group: g.title, groupId: g.id }))\n"
        ");\n\n"
        "export function findService(slug) {\n"
        "  return SERVICES.find((s) => s.slug === slug) || null;\n"
        "}\n\n"
        "export function findBarber(slug) {\n"
        "  return SITE.barbers.find((b) => b.slug === slug) || null;\n"
        "}\n"
    )
    (OUT / "assets" / "js" / "site-data.js").write_text(body and out, encoding="utf-8")


def write_sitemap(site):
    base = site["brand"]["baseUrl"]
    today = date.today().isoformat()
    urls = []
    priorities = {"index": "1.0", "booking": "0.9", "services": "0.9"}
    for p in PAGES:
        if p.get("noindex"):
            continue
        loc = base + ("" if p["slug"] == "index" else f'{p["slug"]}.html')
        urls.append(
            f"  <url>\n    <loc>{loc}</loc>\n    <lastmod>{today}</lastmod>\n"
            f'    <changefreq>monthly</changefreq>\n'
            f'    <priority>{priorities.get(p["slug"], "0.7")}</priority>\n  </url>'
        )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls)
        + "\n</urlset>\n"
    )
    (OUT / "sitemap.xml").write_text(xml, encoding="utf-8")

    robots = (
        "User-agent: *\n"
        "Allow: /\n\n"
        f"Sitemap: {base}sitemap.xml\n"
    )
    (OUT / "robots.txt").write_text(robots, encoding="utf-8")


def write_manifest(site):
    data = {
        "name": site["brand"]["legalName"],
        "short_name": "Kenny's",
        "description": PAGES[0]["desc"],
        "start_url": "./index.html",
        "scope": "./",
        "display": "standalone",
        "background_color": "#0E0E10",
        "theme_color": "#0E0E10",
        "icons": [
            {"src": "./assets/logo/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "./assets/logo/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "./assets/logo/favicon.svg", "sizes": "any", "type": "image/svg+xml"},
        ],
    }
    (OUT / "site.webmanifest").write_text(
        json.dumps(data, indent=2), encoding="utf-8"
    )


# --------------------------------------------------------------------------
# Guard: GitHub Pages project sites live at a subpath, so root-absolute
# local paths (/assets/...) silently 404. Fail the build instead.
# --------------------------------------------------------------------------

ABS_PATH_RE = re.compile(r'(?:href|src)="(/(?!/)[^"]*)"')


def check_relative_paths(name, html):
    bad = ABS_PATH_RE.findall(html)
    if bad:
        raise SystemExit(
            f"\n  BUILD FAILED in {name}.html\n"
            f"  Root-absolute local paths break the GitHub Pages subpath deploy.\n"
            f"  Offending: {bad}\n"
            f"  Use ./assets/... or page.html instead.\n"
        )


def main():
    site = json.loads(read(SRC / "data" / "site.json"))

    OUT.mkdir(exist_ok=True)
    for sub in ("assets/css", "assets/js", "assets/img", "assets/fonts", "assets/logo"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)

    built = []
    for page in PAGES:
        html = render(page, site)
        check_relative_paths(page["slug"], html)
        (OUT / f'{page["slug"]}.html').write_text(html, encoding="utf-8")
        built.append(page["slug"])

    write_site_data(site)
    write_sitemap(site)
    write_manifest(site)
    (OUT / ".nojekyll").write_text("", encoding="utf-8")

    n_services = sum(len(g["services"]) for g in site["serviceGroups"])
    print(f"  Built {len(built)} pages -> docs/")
    print(f"    {', '.join(s + '.html' for s in built)}")
    print(f"  {n_services} services, {len(site['barbers'])} barbers, "
          f"sitemap, robots, manifest, site-data.js")
    print("  All local paths relative. OK.")


if __name__ == "__main__":
    main()
