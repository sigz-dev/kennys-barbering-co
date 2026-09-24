#!/usr/bin/env python3
"""
Download, crop, grade and write every site image at three widths.

Photos come from Unsplash. Cropping and resizing happen server-side via
Unsplash's own CDN parameters (no local image pipeline needed), then each
frame gets a light, consistent editorial grade so that photographs from a
dozen different shoots read as one brand rather than as stock.

    python tests/build_images.py            # only what's missing
    python tests/build_images.py --force    # re-download everything

Output: docs/assets/img/<name>-{640,1280,1920}.jpg
"""

import concurrent.futures as cf
import io
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps

ROOT = Path(__file__).parent.parent
IMG_DIR = ROOT / "docs" / "assets" / "img"

CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

WIDTHS = (640, 1280, 1920)

# Aspect ratios, as width / height
AR = {
    "wide": 16 / 9,
    "hero": 16 / 9,
    "landscape": 3 / 2,
    "service": 4 / 3,
    "portrait": 4 / 5,
    "tall": 3 / 4,
}

# Grade strength: how far each frame is pulled toward the house duotone.
GRADE = {"barber": 0.24, "normal": 0.13, "hero": 0.20}

# name -> (unsplash id, aspect, crop hint, grade profile)
MANIFEST = {
    # --- hero & shop -----------------------------------------------------
    "hero":            ("photo-1585747860715-2ba37e788b70", "hero", "entropy", "hero"),
    "shop-interior":   ("photo-1592647420148-bfcc177e2117", "landscape", "entropy", "normal"),
    "shop-chair":      ("photo-1621645582931-d1d3e6564943", "portrait", "entropy", "normal"),
    "shop-exterior":   ("photo-1678356164573-9a534fe43958", "landscape", "entropy", "normal"),
    "shop-mirrors":    ("photo-1629881543350-9c14f791df99", "landscape", "entropy", "normal"),
    "shop-moody":      ("photo-1703792686658-24e62d626ed2", "wide", "entropy", "hero"),

    # --- barbers ---------------------------------------------------------
    "barber-kenny":    ("photo-1512864084360-7c0c4d0a0845", "portrait", "faces", "barber"),
    "barber-thabo":    ("photo-1703792684940-a05aa0f1188f", "portrait", "faces", "barber"),
    "barber-rea":      ("photo-1602982903808-29f783644d21", "portrait", "faces", "barber"),
    "barber-ayanda":   ("photo-1635273051937-a0ddef9573b6", "portrait", "faces", "barber"),

    # --- services --------------------------------------------------------
    "service-signature": ("photo-1582771498000-8ad44e6c84db", "service", "entropy", "normal"),
    "service-fade":      ("photo-1647140655214-e4a2d914971f", "service", "entropy", "normal"),
    "service-scissor":   ("photo-1657105052497-f996284ffff8", "service", "entropy", "normal"),
    "service-student":   ("photo-1640301133857-c4bc5789c1bb", "service", "entropy", "normal"),
    "service-kids":      ("photo-1704072650662-76df3af134a7", "service", "faces", "normal"),
    "service-beard":     ("photo-1599011176306-4a96f1516d4d", "service", "entropy", "normal"),
    "service-shave":     ("photo-1596728325488-58c87691e9af", "service", "entropy", "normal"),
    "service-headshave": ("photo-1635273051839-003bf06a8751", "service", "entropy", "normal"),
    "service-full":      ("photo-1503951914875-452162b0f3f1", "service", "entropy", "normal"),
    "service-cutbeard":  ("photo-1599351431202-1e0f0137899a", "service", "entropy", "normal"),
    "service-fatherson": ("photo-1703792685152-d13e206924d8", "service", "faces", "normal"),
    "service-lineup":    ("photo-1640301133543-41fe25ad6450", "service", "entropy", "normal"),
    "service-grey":      ("photo-1598524374912-6b0b0bab43dd", "service", "entropy", "normal"),
    "service-scalp":     ("photo-1780504542368-0c5be0c95f86", "service", "entropy", "normal"),

    # --- gallery ---------------------------------------------------------
    "gallery-01": ("photo-1567894340315-735d7c361db0", "portrait", "entropy", "normal"),
    "gallery-02": ("photo-1630827020718-3433092696e7", "tall", "faces", "normal"),
    "gallery-03": ("photo-1532710093739-9470acff878f", "landscape", "entropy", "normal"),
    "gallery-04": ("photo-1621605815971-fbc98d665033", "landscape", "entropy", "normal"),
    "gallery-05": ("photo-1593702275687-f8b402bf1fb5", "portrait", "entropy", "normal"),
    "gallery-06": ("photo-1512690459411-b9245aed614b", "landscape", "entropy", "normal"),
    "gallery-07": ("photo-1672642150228-3fcd5826ec26", "tall", "entropy", "normal"),
    "gallery-08": ("photo-1622286342621-4bd786c2447c", "landscape", "entropy", "normal"),
    "gallery-09": ("photo-1621607512214-68297480165e", "landscape", "entropy", "normal"),
    "gallery-10": ("photo-1585581905588-9e91f63bdd47", "portrait", "entropy", "normal"),
    "gallery-11": ("photo-1517832606299-7ae9b720a186", "landscape", "entropy", "normal"),
}

# House duotone: ink shadows, brass midtones, bone highlights.
DUO_BLACK = (16, 15, 18)
DUO_MID = (124, 103, 74)
DUO_WHITE = (246, 243, 237)


def grade(im, strength):
    """Pull a frame gently toward the house duotone so mixed sources cohere."""
    im = ImageEnhance.Color(im).enhance(0.86)
    im = ImageEnhance.Contrast(im).enhance(1.07)
    duo = ImageOps.colorize(
        ImageOps.grayscale(im), black=DUO_BLACK, mid=DUO_MID, white=DUO_WHITE
    )
    return Image.blend(im, duo, strength)


def fetch(pid, w, h, crop):
    url = (
        f"https://images.unsplash.com/{pid}"
        f"?w={w}&h={h}&fit=crop&crop={crop}&q=85&fm=jpg&auto=format"
    )
    req = urllib.request.Request(url, headers={"User-Agent": CHROME_UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def build_one(item, force):
    name, (pid, aspect, crop, profile) = item
    ratio = AR[aspect]
    strength = GRADE[profile]
    made = []

    for w in WIDTHS:
        out = IMG_DIR / f"{name}-{w}.jpg"
        if out.exists() and not force:
            continue
        h = max(1, round(w / ratio))
        im = fetch(pid, w, h, crop)
        im = grade(im, strength)
        im.save(out, "JPEG", quality=82, optimize=True, progressive=True)
        made.append(w)

    return name, made, aspect


def main():
    force = "--force" in sys.argv
    IMG_DIR.mkdir(parents=True, exist_ok=True)

    todo = list(MANIFEST.items())
    done = 0
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        futures = [ex.submit(build_one, it, force) for it in todo]
        for f in cf.as_completed(futures):
            name, made, aspect = f.result()
            done += 1
            tag = ",".join(str(w) for w in made) if made else "cached"
            print(f"  [{done:2}/{len(todo)}] {name:20} {aspect:10} {tag}")

    files = sorted(IMG_DIR.glob("*.jpg"))
    total = sum(f.stat().st_size for f in files)
    print(f"\n  {len(files)} files, {total / 1024 / 1024:.1f} MB -> docs/assets/img/")
    print(f"  {len(MANIFEST)} distinct images x {len(WIDTHS)} widths")


if __name__ == "__main__":
    main()
