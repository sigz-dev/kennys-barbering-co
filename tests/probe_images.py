#!/usr/bin/env python3
"""Probe candidate Unsplash photo IDs for availability before committing to them."""

import concurrent.futures as cf
import urllib.request
import urllib.error

CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

CANDIDATES = [
    "photo-1503951914875-452162b0f3f1",
    "photo-1521590832167-7bcbfaa6381f",
    "photo-1599351431202-1e0f0137899a",
    "photo-1585747860715-2ba37e788b70",
    "photo-1622286342621-4bd786c2447c",
    "photo-1560066984-138dadb4c035",
    "photo-1567894340315-735d7c361db0",
    "photo-1596728325488-58c87691e9af",
    "photo-1605497788044-5a32c7078486",
    "photo-1512690459411-b9245aed614b",
    "photo-1493256338651-d82f7acb2b38",
    "photo-1580618672591-eb180b1a973f",
    "photo-1593702275687-f8b402bf1fb5",
    "photo-1519500099198-fd81846b8f03",
    "photo-1635273051937-a0b4c5c1c6e9",
    "photo-1621605815971-fbc98d665033",
    "photo-1616683693504-3ea7e9ad6fec",
    "photo-1634449571010-02389ed0f9b0",
    "photo-1617896848219-5e5d2e2e5b42",
    "photo-1606565239862-b0e0e1a1a1a1",
    "photo-1552642986-ccb41e7059e7",
    "photo-1570172619644-dfd03ed5d881",
    "photo-1517832606299-7ae9b720a186",
    "photo-1503443207922-dff7d543fd0e",
    "photo-1587909209111-5097ee578ec3",
    "photo-1590540179852-2110a54f813a",
    "photo-1621607512214-68297480165e",
    "photo-1533675189244-8cc1c1a2b3c4",
    "photo-1626015449456-e9b0f0f9d8e1",
    "photo-1635342142317-0a8b4a2e1e3e",
    "photo-1519345182560-3f2917c472ef",
    "photo-1506794778202-cad84cf45f1d",
    "photo-1507003211169-0a1dd7228f2d",
    "photo-1500648767791-00dcc994a43e",
    "photo-1472099645785-5658abf4ff4e",
    "photo-1570295999919-56ceb5ecca61",
    "photo-1618077360395-f3068be8e001",
    "photo-1584316712724-f5d4b188fee2",
    "photo-1621607512022-6aecc4fed814",
    "photo-1559599076-9c61d8e1b77c",
]


def probe(pid):
    url = f"https://images.unsplash.com/{pid}?w=200&q=50&fm=jpg"
    req = urllib.request.Request(url, headers={"User-Agent": CHROME_UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return pid, r.status, r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return pid, e.code, "-"
    except Exception as e:
        return pid, "ERR", str(e)[:40]


if __name__ == "__main__":
    ok, bad = [], []
    with cf.ThreadPoolExecutor(max_workers=10) as ex:
        for pid, status, ctype in ex.map(probe, CANDIDATES):
            (ok if status == 200 else bad).append(pid)
            print(f"  {status}  {pid}  {ctype}")
    print(f"\n  {len(ok)} OK / {len(bad)} unavailable")
    print("\nOK IDS:")
    for p in ok:
        print(f'    "{p}",')
