#!/usr/bin/env python3
"""Wire catalog candidates to the 2 × 2 km windows in sites.json.

This keeps `site/data/catalog.json` and `public/data/catalog.json` in sync and
ensures every candidate has a studyArea the map and inspector can use.

    python scripts/sync_catalog.py
"""
from __future__ import annotations

import json
import math
import shutil

from common import PUBLIC_DATA, ROOT, SITE_DATA, banner, read_json, step, utc_now_iso, write_json
from config import SITES


def ring(lat: float, lon: float, half_km: float) -> list[list[float]]:
    dlat = half_km / 110.574
    dlon = half_km / (111.32 * max(0.05, math.cos(math.radians(lat))))
    return [
        [round(lon - dlon, 6), round(lat - dlat, 6)],
        [round(lon + dlon, 6), round(lat - dlat, 6)],
        [round(lon + dlon, 6), round(lat + dlat, 6)],
        [round(lon - dlon, 6), round(lat + dlat, 6)],
        [round(lon - dlon, 6), round(lat - dlat, 6)],
    ]


def main() -> int:
    banner("Catalog · study-area wiring")
    catalog_path = SITE_DATA / "catalog.json"
    if not catalog_path.is_file():
        raise SystemExit("site/data/catalog.json is missing")
    catalog = read_json(catalog_path)
    by_id = {s["site_id"]: s for s in SITES}
    for candidate in catalog.get("candidates", []):
        site = by_id.get(candidate.get("id"))
        if not site:
            continue
        r = ring(site["lat"], site["lon"], site["half_km"])
        candidate["status"] = "bounded_study_window"
        candidate["studyArea"] = {
            "studyId": f"{site['site_id']}-window",
            "label": site["window_label"],
            "boundsXY": [r[0][0], r[0][1], r[2][0], r[2][1]],
            "crsId": "EPSG:4326",
            "ringWGS84": r,
            "centreWGS84": [site["lon"], site["lat"]],
            "selection": f"{site['note']} Analyst-defined 2 × 2 km sample; not an official boundary or land-access claim.",
        }
    copy = catalog.setdefault("copy", {})
    copy["candidateNote"] = "Bounded 2 × 2 km screening window · computed evidence available"
    copy["listNote"] = (
        "Catalog order, not a ranking. All seven windows are analyst-defined 2 × 2 km samples; "
        "screening evidence is shown in the inspector and detail pages."
    )
    copy["mapRelease"] = (
        "All seven windows are plotted as 2 × 2 km screening footprints. The basemap is coarse context only."
    )
    catalog["screeningWiring"] = {
        "generated": utc_now_iso(),
        "source": "sites.json",
        "note": "studyArea and candidate status are derived from the ETL window definitions; Fit remains a separate screening model.",
    }
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    write_json(PUBLIC_DATA / "catalog.json", catalog)
    shutil.copy2(PUBLIC_DATA / "catalog.json", catalog_path)
    step(f"Wired {len(catalog.get('candidates', []))} candidates in catalog.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
