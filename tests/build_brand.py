#!/usr/bin/env python3
"""
Generate raster brand assets: PWA/apple-touch icons and per-page Open Graph cards.

Pillow can't read woff2, so the display face is pulled as TTF from Google Fonts
(their CSS2 API serves TTF to an unknown User-Agent, which is exactly what we
want here — the reverse of tests/fetch_fonts.py).

    python tests/build_brand.py
"""

import io
import re
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).parent.parent
LOGO_DIR = ROOT / "docs" / "assets" / "logo"
IMG_DIR = ROOT / "docs" / "assets" / "img"
CACHE = Path(__file__).parent / ".fontcache"

INK = (14, 14, 16)
BRASS = (200, 164, 92)
BONE = (244, 241, 234)
BONE_DIM = (168, 164, 155)

OG_W, OG_H = 1200, 630


def get_ttf(css_query, stem):
    """Fetch a static TTF for Pillow. Default UA => Google serves truetype."""
    CACHE.mkdir(exist_ok=True)
    dest = CACHE / f"{stem}.ttf"
    if dest.exists():
        return dest
    css = urllib.request.urlopen(
        f"https://fonts.googleapis.com/css2?{css_query}", timeout=45
    ).read().decode()
    m = re.search(r"url\((https://[^)]+\.ttf)\)", css)
    if not m:
        raise SystemExit(f"  no TTF url for {stem}")
    dest.write_bytes(urllib.request.urlopen(m.group(1), timeout=60).read())
    return dest


def draw_mark(size, rounded=True):
    """The monogram icon, drawn at any size."""
    s = size * 4  # supersample for clean edges
    im = Image.new("RGB", (s, s), INK)
    d = ImageDraw.Draw(im)

    cx = cy = s / 2
    ring_r = s * 0.39
    d.ellipse(
        [cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r],
        outline=BRASS, width=max(2, int(s * 0.033)),
    )

    w = max(2, int(s * 0.066))
    top, bot, mid = s * 0.333, s * 0.667, s * 0.5
    stem_x, arm_x = s * 0.40, s * 0.585
    d.line([stem_x, top, stem_x, bot], fill=BONE, width=w)
    d.line([stem_x, mid, arm_x, top], fill=BONE, width=w)
    d.line([stem_x, mid, arm_x + s * 0.012, bot], fill=BONE, width=w)

    im = im.resize((size, size), Image.LANCZOS)

    if rounded:
        r = int(size * 0.22)
        mask = Image.new("L", (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, size * 4 - 1, size * 4 - 1], radius=r * 4, fill=255
        )
        mask = mask.resize((size, size), Image.LANCZOS)
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(im, (0, 0), mask)
        return out
    return im.convert("RGBA")


def fit_text(draw, text, font_path, max_w, start):
    """Largest size at which text fits max_w."""
    size = start
    while size > 16:
        f = ImageFont.truetype(str(font_path), size)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 4
    return ImageFont.truetype(str(font_path), 16)


def build_og(name, photo, eyebrow, title, display_ttf, ui_ttf):
    base = Image.open(IMG_DIR / f"{photo}-1920.jpg").convert("RGB")

    # cover-crop to the OG frame
    scale = max(OG_W / base.width, OG_H / base.height)
    base = base.resize(
        (round(base.width * scale), round(base.height * scale)), Image.LANCZOS
    )
    left = (base.width - OG_W) // 2
    top = (base.height - OG_H) // 2
    im = base.crop((left, top, left + OG_W, top + OG_H))

    # darken so type always clears the photo
    im = Image.blend(im, Image.new("RGB", im.size, INK), 0.58)
    im = im.filter(ImageFilter.GaussianBlur(1.2))

    # bottom-weighted scrim
    scrim = Image.new("L", (1, OG_H))
    for y in range(OG_H):
        t = y / OG_H
        scrim.putpixel((0, y), int(235 * (t ** 2.1)))
    scrim = scrim.resize((OG_W, OG_H))
    im = Image.composite(Image.new("RGB", im.size, INK), im, scrim)

    d = ImageDraw.Draw(im)
    pad = 72

    mark = draw_mark(96, rounded=False)
    im.paste(mark, (pad, pad), mark)

    f_word = ImageFont.truetype(str(display_ttf), 40)
    d.text((pad + 118, pad + 14), "KENNY'S", font=f_word, fill=BONE)
    f_est = ImageFont.truetype(str(ui_ttf), 17)
    d.text((pad + 120, pad + 62), "B A R B E R I N G   C O .", font=f_est, fill=BRASS)

    f_eye = ImageFont.truetype(str(ui_ttf), 22)
    d.text((pad, OG_H - pad - 168), eyebrow.upper(), font=f_eye, fill=BRASS)

    f_title = fit_text(d, title, display_ttf, OG_W - pad * 2, 86)
    d.text((pad, OG_H - pad - 128), title, font=f_title, fill=BONE)

    f_meta = ImageFont.truetype(str(ui_ttf), 21)
    d.text(
        (pad, OG_H - pad - 26),
        "Parkhurst, Johannesburg   ·   Est. 1998",
        font=f_meta, fill=BONE_DIM,
    )

    d.rectangle([0, OG_H - 7, OG_W, OG_H], fill=BRASS)

    out = IMG_DIR / f"{name}.jpg"
    im.save(out, "JPEG", quality=88, optimize=True, progressive=True)
    return out


OG_CARDS = [
    ("og-home", "hero", "Barbering since 1998", "A cut above."),
    ("og-services", "service-fade", "Services & prices", "Priced properly."),
    ("og-about", "barber-kenny", "Our story", "Four chairs, one standard."),
    ("og-gallery", "gallery-04", "Our work", "The detail is the job."),
    ("og-contact", "shop-exterior", "Find us", "Fourth Avenue, Parkhurst."),
    ("og-booking", "shop-chair", "Book a chair", "Your chair is waiting."),
]


def main():
    LOGO_DIR.mkdir(parents=True, exist_ok=True)
    display = get_ttf("family=Fraunces:opsz,wght@9..144,700", "fraunces")
    ui = get_ttf("family=Archivo:wght@500", "archivo")

    for size, fname in ((192, "icon-192.png"), (512, "icon-512.png"),
                        (180, "apple-touch-icon.png")):
        draw_mark(size).save(LOGO_DIR / fname, "PNG", optimize=True)
        print(f"  icon  {fname:22} {size}x{size}")

    for name, photo, eyebrow, title in OG_CARDS:
        out = build_og(name, photo, eyebrow, title, display, ui)
        print(f"  og    {out.name:22} {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
