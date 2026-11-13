#!/usr/bin/env python3
"""Stage 2 — derive slope and roughness (TRI) for every 2 × 2 km site window.

Planetary DEMs: if a GeoTIFF from stage 1 exists *and* GDAL's ``gdaldem`` is on
PATH, global lunar/Martian slope rasters are produced exactly as in the brief.
Earth windows: Horn slope and Riley TRI are computed with numpy from the cached
Terrarium DEM sample, so the same equations run with or without GDAL.

Usage
-----
    python scripts/derive_slope_roughness.py
    python scripts/derive_slope_roughness.py --site atacama --samples 201
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys

from common import (
    DERIVED,
    ROOT,
    banner,
    read_json,
    step,
    terrain_window,
    utc_now_iso,
    warn,
    write_json,
)
from config import SITES


def gdaldem_slope(src: str, dst: str) -> dict:
    if not shutil.which("gdaldem"):
        return {"status": "gdaldem_missing", "output": None}
    cmd = ["gdaldem", "slope", src, dst, "-compute_edges"]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        return {"status": "ok", "output": dst, "command": " ".join(cmd)}
    return {"status": "error", "output": None, "stderr": res.stderr[-800:]}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--site", action="append", help="limit to one or more site ids")
    ap.add_argument("--samples", type=int, default=161, help="grid samples per side")
    ap.add_argument("--zoom", type=int, default=14)
    args = ap.parse_args()

    banner("Stage 2 · slope & roughness")
    selected = [s for s in SITES if not args.site or s["site_id"] in args.site]
    if not selected:
        warn("No matching site ids.")
        return 2

    planetary = {}
    for body, src, dst in [
        ("Moon", ROOT / "data/raw_dems/moon_lola_118m.tif", DERIVED / "moon_slope.tif"),
        ("Mars", ROOT / "data/raw_dems/mars_mola_463m.tif", DERIVED / "mars_slope.tif"),
    ]:
        if src.is_file():
            step(f"gdaldem slope for {body} …")
            planetary[body] = gdaldem_slope(str(src), str(dst))
        else:
            planetary[body] = {
                "status": "source_dem_absent",
                "output": None,
                "note": "Global planetary slope rasters are deferred until stage 1 downloads a DEM.",
            }
            warn(f"{body} DEM absent; skipping global slope raster.")

    results: dict[str, dict] = {}
    previous = (read_json(DERIVED / "terrain_metrics.json", {}) or {}).get("sites", {})
    for site in selected:
        sid = site["site_id"]
        try:
            metrics, _grid, _lon, _lat = terrain_window(
                site["lat"],
                site["lon"],
                site["half_km"],
                zoom=args.zoom,
                samples=args.samples,
            )
            metrics["site_id"] = sid
            metrics["site_name"] = site["site_name"]
            metrics["status"] = "ok"
            metrics["derived"] = utc_now_iso()
            results[sid] = metrics
            step(
                f"{sid:18s} relief {metrics['relief_m']:7.1f} m · "
                f"slope {metrics['slope_mean_deg']:5.2f}° (p95 {metrics['slope_p95_deg']:5.2f}) · "
                f"TRI {metrics['tri_mean']:.3f}"
            )
        except Exception as exc:  # network/tile failure must not lose prior work
            warn(f"{sid}: terrain derivation failed — {exc}")
            if sid in previous:
                results[sid] = {**previous[sid], "status": "stale_cached", "error": str(exc)}
                warn(f"{sid}: re-using the previous cached metrics.")
            else:
                results[sid] = {"site_id": sid, "status": "error", "error": str(exc)}

    payload = {
        "schemaVersion": "1.0",
        "generated": utc_now_iso(),
        "method": {
            "slope": "Horn (1981) 3×3 finite difference, degrees",
            "roughness": "Riley et al. (1999) Terrain Ruggedness Index, dimensionless",
            "earth_dem": "AWS Terrain Tiles (Terrarium) z14, bilinearly sampled",
            "planetary": planetary,
        },
        "sites": results,
    }
    write_json(DERIVED / "terrain_metrics.json", payload)
    ok = sum(1 for v in results.values() if v.get("status") == "ok")
    step(f"Wrote {DERIVED / 'terrain_metrics.json'} ({ok}/{len(results)} windows current)")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
