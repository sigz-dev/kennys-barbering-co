#!/usr/bin/env python3
"""Contact sheet of the processed local images, to eyeball the grade and crops."""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).parent.parent
IMG_DIR = ROOT / "docs" / "assets" / "img"
CELL_W, CELL_H, COLS, PAD = 300, 240, 5, 24


def main():
    pattern = sys.argv[1] if len(sys.argv) > 1 else "*"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "tests" / "review.jpg"

    files = sorted(IMG_DIR.glob(f"{pattern}-640.jpg"))
    if not files:
        sys.exit(f"  nothing matched {pattern}-640.jpg")

    rows = (len(files) + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS * CELL_W, rows * (CELL_H + PAD)), (10, 10, 12))
    draw = ImageDraw.Draw(sheet)

    for i, f in enumerate(files):
        im = Image.open(f).convert("RGB")
        im.thumbnail((CELL_W - 8, CELL_H - 8), Image.LANCZOS)
        col, row = i % COLS, i // COLS
        x, y = col * CELL_W, row * (CELL_H + PAD)
        sheet.paste(im, (x + (CELL_W - im.width) // 2, y + PAD + (CELL_H - im.height) // 2))
        draw.text((x + 6, y + 6), f.stem.replace("-640", ""), fill=(200, 164, 92))

    sheet.save(out, quality=85)
    print(f"  {len(files)} images -> {out}")


if __name__ == "__main__":
    main()
