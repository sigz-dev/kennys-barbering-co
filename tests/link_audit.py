#!/usr/bin/env python3
"""
Audit the built site for broken local links, missing assets and common slips.

Catches the things that only show up after deploy: a mistyped image name, a
page that was renamed, an anchor pointing at an id that doesn't exist, or a
root-absolute path that will 404 on a GitHub Pages project subpath.

    python tests/link_audit.py
"""

import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).parent.parent
OUT = ROOT / "docs"

EXTERNAL_SCHEMES = {"http", "https", "mailto", "tel", "data", "javascript"}


class Collector(HTMLParser):
    """Pull out every link, asset reference, element id and srcset entry."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.refs = []      # (attr, value)
        self.ids = set()
        self.imgs = []      # (src, has_dims, has_alt)
        self.labels = 0
        self.h1 = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)

        if "id" in a:
            self.ids.add(a["id"])
        if tag == "h1":
            self.h1 += 1

        for attr in ("href", "src", "action"):
            if a.get(attr):
                self.refs.append((attr, a[attr]))

        if a.get("srcset"):
            for part in a["srcset"].split(","):
                url = part.strip().split(" ")[0]
                if url:
                    self.refs.append(("srcset", url))

        if tag == "img":
            self.imgs.append((
                a.get("src", ""),
                bool(a.get("width")) and bool(a.get("height")),
                "alt" in a,
            ))


def audit():
    problems = []
    warnings = []

    pages = sorted(OUT.glob("*.html"))
    if not pages:
        sys.exit("  No built pages found. Run `python build.py` first.")

    # Map every page to the ids it defines, so cross-page anchors can be checked.
    ids_by_page = {}
    parsed = {}
    for page in pages:
        c = Collector()
        c.feed(page.read_text(encoding="utf-8"))
        parsed[page.name] = c
        ids_by_page[page.name] = c.ids

    checked = 0
    for page in pages:
        c = parsed[page.name]
        here = page.name

        if c.h1 != 1:
            warnings.append(f"{here}: expected exactly one <h1>, found {c.h1}")

        for src, has_dims, has_alt in c.imgs:
            if not has_alt:
                problems.append(f"{here}: <img src=\"{src}\"> has no alt attribute")
            if not has_dims:
                warnings.append(f"{here}: <img src=\"{src}\"> has no width/height (layout shift)")

        for attr, raw in c.refs:
            value = raw.strip()
            if not value:
                problems.append(f"{here}: empty {attr}")
                continue

            scheme = urlparse(value).scheme
            if scheme in EXTERNAL_SCHEMES:
                continue

            if value.startswith("//"):
                continue

            # Root-absolute local paths break the GitHub Pages subpath deploy.
            if value.startswith("/"):
                problems.append(f"{here}: root-absolute path {attr}=\"{value}\"")
                continue

            # Pure fragment -> must exist on this page.
            if value.startswith("#"):
                frag = unquote(value[1:])
                if frag and frag not in c.ids:
                    problems.append(f"{here}: anchor \"#{frag}\" has no matching id")
                continue

            path_part, _, frag = value.partition("#")
            path_part = unquote(path_part.split("?")[0])
            if not path_part:
                continue

            target = (OUT / path_part).resolve()
            checked += 1

            if not target.exists():
                problems.append(f"{here}: {attr}=\"{value}\" -> missing {path_part}")
                continue

            if frag and target.name.endswith(".html"):
                known = ids_by_page.get(target.name)
                if known is not None and unquote(frag) not in known:
                    problems.append(
                        f"{here}: \"{value}\" -> {target.name} has no id \"{frag}\""
                    )

    # Every referenced image should have all three widths present.
    for img in sorted(OUT.glob("assets/img/*-1280.jpg")):
        stem = img.name.replace("-1280.jpg", "")
        for w in (640, 1920):
            sibling = OUT / "assets" / "img" / f"{stem}-{w}.jpg"
            if not sibling.exists():
                warnings.append(f"assets/img: {stem} missing the {w}w variant")

    # Required side files.
    for required in ("sitemap.xml", "robots.txt", "site.webmanifest", ".nojekyll",
                     "assets/css/site.css", "assets/css/fonts.css",
                     "assets/js/main.js", "assets/js/site-data.js",
                     "assets/logo/favicon.svg", "assets/logo/apple-touch-icon.png"):
        if not (OUT / required).exists():
            problems.append(f"missing required file: {required}")

    # Nothing in the deployed folder should reference the source tree.
    for page in pages:
        text = page.read_text(encoding="utf-8")
        for needle in ("{{", "}}", "TODO", "Lorem ipsum", "lorem ipsum"):
            if needle in text:
                problems.append(f"{page.name}: contains unresolved/placeholder text \"{needle}\"")

    print(f"  {len(pages)} pages, {checked} local references checked")

    if warnings:
        print(f"\n  {len(warnings)} warning(s):")
        for w in warnings:
            print(f"    ! {w}")

    if problems:
        print(f"\n  {len(problems)} PROBLEM(S):")
        for p in problems:
            print(f"    x {p}")
        return 1

    print("\n  No broken links, no missing assets, no placeholders. OK.")
    return 0


if __name__ == "__main__":
    sys.exit(audit())
