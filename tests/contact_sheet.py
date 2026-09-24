#!/usr/bin/env python3
"""
Build a labelled contact sheet of candidate photos so they can be reviewed at a glance.

    python tests/contact_sheet.py ids.txt out.jpg

ids.txt: one Unsplash photo ID per line; blank lines and # comments ignored.
"""

import concurrent.futures as cf
import io
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

CELL_W, CELL_H, COLS, PAD = 300, 225, 5, 26


def grab(item):
    i, pid = item
    url = f"https://images.unsplash.com/{pid}?w={CELL_W * 2}&q=70&fm=jpg&fit=crop"
    req = urllib.request.Request(url, headers={"User-Agent": CHROME_UA})
    canvas = Image.new("RGB", (CELL_W, CELL_H), (20, 20, 24))
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            im = Image.open(io.BytesIO(r.read())).convert("RGB")
        im.thumbnail((CELL_W, CELL_H), Image.LANCZOS)
        canvas.paste(im, ((CELL_W - im.width) // 2, (CELL_H - im.height) // 2))
    except Exception as e:
        ImageDraw.Draw(canvas).text((10, CELL_H // 2), f"FAIL {e}"[:40], fill=(200, 80, 80))
    return i, canvas


def main():
    ids_file = Path(sys.argv[1])
    out = Path(sys.argv[2])
    ids = [
        ln.strip() for ln in ids_file.read_text(encoding="utf-8").splitlines()
        if ln.strip() and not ln.strip().startswith("#")
    ]

    rows = (len(ids) + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS * CELL_W, rows * (CELL_H + PAD)), (10, 10, 12))
    draw = ImageDraw.Draw(sheet)

    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        for i, cell in ex.map(grab, list(enumerate(ids))):
            col, row = i % COLS, i // COLS
            x, y = col * CELL_W, row * (CELL_H + PAD)
            sheet.paste(cell, (x, y + PAD))
            draw.text((x + 6, y + 6), f"#{i:02d}", fill=(200, 164, 92))

    sheet.save(out, quality=82)
    print(f"  {len(ids)} thumbnails -> {out}  ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()
