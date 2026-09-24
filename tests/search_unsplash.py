#!/usr/bin/env python3
"""
Find real Unsplash photo IDs for a search term.

Unsplash's JSON endpoint now requires auth, so this scrapes the
server-rendered search page and pulls photo IDs out of the embedded
image URLs. Returns verified IDs, so shots can be chosen deliberately
rather than guessed.

    python tests/search_unsplash.py "female barber" 20
"""

import gzip
import io
import re
import sys
import urllib.parse
import urllib.request
import zlib

CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# images.unsplash.com/photo-<epoch>-<hash>
ID_RE = re.compile(r"images\.unsplash\.com/(photo-\d{10,}-[0-9a-f]{8,})")
# "alt_description":"..." sits next to each photo in the embedded payload
ALT_RE = re.compile(r'"alt_description":(?:"((?:[^"\\]|\\.)*)"|null)')


def get(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": CHROME_UA,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Encoding": "gzip, deflate",
            "Accept-Language": "en-GB,en;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=45) as r:
        raw = r.read()
        enc = r.headers.get("Content-Encoding", "")
    if enc == "gzip":
        raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
    elif enc == "deflate":
        raw = zlib.decompress(raw, -zlib.MAX_WBITS)
    return raw.decode("utf-8", "replace")


def main():
    query = sys.argv[1] if len(sys.argv) > 1 else "barber"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20

    url = "https://unsplash.com/s/photos/" + urllib.parse.quote(query.replace(" ", "-"))
    html = get(url)

    seen, ids = set(), []
    for m in ID_RE.finditer(html):
        pid = m.group(1)
        if pid not in seen:
            seen.add(pid)
            ids.append(pid)

    alts = [a for a in ALT_RE.findall(html) if a]

    print(f"  '{query}' -> {len(ids)} unique photo IDs\n")
    for i, pid in enumerate(ids[:limit]):
        alt = alts[i][:88] if i < len(alts) else ""
        print(f'    "{pid}",  # {alt}')


if __name__ == "__main__":
    main()
