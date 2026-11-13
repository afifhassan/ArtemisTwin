#!/usr/bin/env python3
"""Stage 6 — publish the static payloads.

Writes the canonical files to ``public/data`` and mirrors them into
``site/data`` (the directory the static app actually fetches). Existing catalog
files are never touched.

Usage
-----
    python scripts/export_data.py
    python scripts/export_data.py --no-mirror
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import shutil

from common import (
    DATA,
    DERIVED,
    PUBLIC_DATA,
    ROOT,
    SITE_DATA,
    banner,
    env,
    jwt_expiry,
    read_json,
    sha256_bytes,
    step,
    utc_now_iso,
    write_json,
    write_text,
)
from config import (
    EARTH_LIMITS,
    LAYERS,
    MODEL,
    PURPOSES,
    SITE_COLUMNS,
    SOURCE_NOTES,
    TARGETS,
)

SITE_CSV_FIELDS = [
    "site_id",
    "site_name",
    "country",
    "region",
    "catalog_id",
    "lat",
    "lon",
    "window_km",
    "L1_relief_m",
    "L1_elevation_mean_m",
    "L1_elevation_min_m",
    "L1_elevation_max_m",
    *SITE_COLUMNS.values(),
    "L2_slope_p95",
    "L3_roughness_p95",
    "L4_temp_mean",
    "L4_warm_month",
    "L4_cold_month",
    "L9_aod_550",
    "wind_ms",
    "rain_mm_year",
    "rh_pct",
    "data_completeness_pct",
    "present_layers",
    "missing_layers",
]

PUBLISH = [
    "layers.csv",
    "layers.json",
    "sites.csv",
    "sites.json",
    "targets.json",
    "scores.json",
    "model.json",
    "provenance.json",
    "earth_analog_sites.geojson",
    "sites_extracted.csv",
    "manifest.json",
]


def write_csv(path, rows, fields):
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for row in rows:
        out = {}
        for key in fields:
            val = row.get(key)
            if isinstance(val, list):
                val = ";".join(str(v) for v in val)
            out[key] = "" if val is None else val
        writer.writerow(out)
    write_text(path, buf.getvalue())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--no-mirror", action="store_true", help="do not copy into site/data")
    args = ap.parse_args()

    banner("Stage 6 · export static payloads")
    records = (read_json(DERIVED / "site_records.json", {}) or {}).get("sites", [])
    scores = read_json(PUBLIC_DATA / "scores.json", {}) or {}
    terrain = read_json(DERIVED / "terrain_metrics.json", {}) or {}
    climate = read_json(DERIVED / "earth_climate.json", {}) or {}
    dems = read_json(DERIVED / "dem_manifest.json", {}) or {}
    appeears = read_json(DERIVED / "appeears_status.json", {}) or {}
    diviner = read_json(DERIVED / "diviner_status.json", {}) or {}
    pipeline = read_json(DERIVED / "pipeline_run.json", {}) or {}

    if not records:
        raise SystemExit("No site records; run zonal_stats_extractor.py first.")
    if not scores:
        raise SystemExit("No scores; run scoring_engine.py first.")

    # 1. layers.csv / layers.json -------------------------------------------------
    layer_rows = [
        {
            "layer_id": layer["layer_id"],
            "layer_key": layer["layer_key"],
            "layer_name": layer["layer_name"],
            "planetary_source": layer["planetary_source"],
            "earth_source": layer["earth_source"],
            "unit": layer["unit"],
            "category": layer["category"],
            "comparability": layer["comparability"],
            "basis": layer["basis"],
        }
        for layer in LAYERS
    ]
    write_csv(
        PUBLIC_DATA / "layers.csv",
        layer_rows,
        [
            "layer_id",
            "layer_key",
            "layer_name",
            "planetary_source",
            "earth_source",
            "unit",
            "category",
            "comparability",
            "basis",
        ],
    )
    write_json(
        PUBLIC_DATA / "layers.json",
        {
            "schemaVersion": "1.0",
            "generated": utc_now_iso(),
            "layers": LAYERS,
            "note": "Comparability: direct | proxy | excluded | context. Proxy layers receive half weight; excluded layers are never scored.",
        },
    )

    # 2. sites.csv / sites.json ---------------------------------------------------
    write_csv(PUBLIC_DATA / "sites.csv", records, SITE_CSV_FIELDS)
    write_json(
        PUBLIC_DATA / "sites.json",
        {
            "schemaVersion": "1.0",
            "generated": utc_now_iso(),
            "window": "2 × 2 km screening window per site",
            "caveat": "Windows are analytical samples, not selected test sites, permitted areas or regional averages.",
            "sites": records,
        },
    )

    # 3. targets.json -------------------------------------------------------------
    targets_payload = {
        "schemaVersion": "1.0",
        "methodVersion": MODEL["method_version"],
        "generated": utc_now_iso(),
        "scientificNote": (
            "Target values are screening envelopes for a stated purpose, not measurements of one landing site "
            "and not a site selection. Earth cannot reproduce gravity, vacuum, radiation or true polar lighting."
        ),
        "sources": SOURCE_NOTES,
        "planetary_targets": [
            {
                "target_id": t["target_id"],
                "target_name": t["target_name"],
                "body": t["body"],
                "catalog_id": t["catalog_id"],
                "status": t["status"],
                "study_area": t["study_area"],
                "envelope_note": t["envelope_note"],
                "layers": t["layers"],
            }
            for t in TARGETS
        ],
    }
    write_json(PUBLIC_DATA / "targets.json", targets_payload)

    # 4. model.json ---------------------------------------------------------------
    model_payload = {
        **MODEL,
        "generated": utc_now_iso(),
        "layer_registry": LAYERS,
        "purposes": PURPOSES,
        "earth_limits": EARTH_LIMITS,
        "target_ids": [t["target_id"] for t in TARGETS],
        "site_ids": [r["site_id"] for r in records],
        "site_columns": SITE_COLUMNS,
        "formula": {
            "layer_score": "s_i = max(0, 1 - min(1, |earth_i - target_i| / tolerance_i))",
            "fit": "100 * Σ(effective_weight_i * s_i) / Σ(effective_weight_i), over available non-excluded layers",
            "effective_weight": "purpose_weight * (0.5 if comparability=proxy else 1)",
            "completeness": "100 * layers with an Earth value / 12",
            "confidence_band": "10th–90th percentile of the Monte Carlo fit distribution",
        },
        "limits": [
            "Fit depends on analyst-set target envelopes and purpose weights; a different envelope changes the score.",
            "The band does not include unmeasured conditions; read the missing-data sensitivity separately.",
            "60/100 is not a pass mark. There is no validated threshold for mission relevance.",
        ],
    }
    write_json(PUBLIC_DATA / "model.json", model_payload)

    # 5. provenance.json ----------------------------------------------------------
    provenance = {
        "schemaVersion": "1.0",
        "generated": utc_now_iso(),
        "credentials": {
            "earthdata_user": env("EARTHDATA_USER"),
            "earthdata_token_expires": jwt_expiry(env("NASA_EARTHDATA_TOKEN")),
            "nasa_api_key": "present in .env; never bundled into site/",
        },
        "pipeline_stages": [
            {"stage": 1, "script": "scripts/download_dems.py", "output": "data/derived/dem_manifest.json"},
            {"stage": 2, "script": "scripts/derive_slope_roughness.py", "output": "data/derived/terrain_metrics.json"},
            {"stage": 3, "script": "scripts/nasa_power_climate.py", "output": "data/derived/earth_climate.json"},
            {"stage": 4, "script": "scripts/zonal_stats_extractor.py", "output": "data/derived/site_records.json"},
            {"stage": 5, "script": "scripts/scoring_engine.py", "output": "public/data/scores.json"},
            {"stage": 6, "script": "scripts/export_data.py", "output": "public/data/ + site/data/"},
        ],
        "dem_manifest": dems,
        "appeears": {
            "status": appeears.get("status"),
            "note": appeears.get("note"),
            "token_check": appeears.get("token_check"),
            "task_id": appeears.get("task_id"),
        },
        "diviner": {
            "status": diviner.get("status"),
            "note": diviner.get("note"),
            "raster_mb": diviner.get("raster_mb"),
            "published_context": diviner.get("published_context"),
        },
        "pipeline_run": {
            "generated": pipeline.get("generated"),
            "ok": pipeline.get("ok"),
            "stages": pipeline.get("stages"),
        },
        "terrain_method": terrain.get("method"),
        "terrain_by_site": {
            sid: {
                "status": v.get("status"),
                "source": v.get("source"),
                "cell_m": v.get("cell_m"),
                "derived": v.get("derived"),
            }
            for sid, v in (terrain.get("sites") or {}).items()
        },
        "climate_by_site": {
            sid: {
                "status": v.get("status"),
                "provenance": v.get("provenance"),
                "units": v.get("units"),
            }
            for sid, v in (climate.get("sites") or {}).items()
        },
        "layer_sources": {
            "earth_terrain": "AWS Terrain Tiles / Terrarium (public, keyless) — SRTM/3DEP/ASTER/ETOPO1 composite",
            "earth_climate": "NASA POWER climatology (MERRA-2), community RE",
            "earth_lst": "Not acquired: AppEEARS MOD11A1 task is implemented but was not submitted. POWER TS is used as a proxy.",
            "earth_ice_mineral_rock_cave_access": "Not acquired in this build; listed as named gaps.",
            "lunar_thermal": "Diviner published values used for target envelopes; global raster download deferred by size budget.",
            "mars_target": "MOLA/published context; analyst-set screening envelope.",
        },
        "not_evidence": [
            "No Earth site is an exact or equal match to the Moon or Mars.",
            "No result here is an astronaut-safety or operational recommendation.",
            "Terrain metrics describe a 2 × 2 km window at the sampled grid, not wheel-scale rocks or traversability.",
        ],
    }
    write_json(PUBLIC_DATA / "provenance.json", provenance)

    # 6. manifest.json ------------------------------------------------------------
    manifest = {"schemaVersion": "1.0", "generated": utc_now_iso(), "files": {}}
    for name in PUBLISH:
        if name == "manifest.json":
            continue
        path = PUBLIC_DATA / name
        if path.is_file():
            manifest["files"][name] = {
                "bytes": path.stat().st_size,
                "sha256": sha256_bytes(path.read_bytes()),
            }
    write_json(PUBLIC_DATA / "manifest.json", manifest)

    # 7. mirror to site/data ------------------------------------------------------
    if not args.no_mirror:
        SITE_DATA.mkdir(parents=True, exist_ok=True)
        for name in PUBLISH:
            src = PUBLIC_DATA / name
            if src.is_file():
                shutil.copy2(src, SITE_DATA / name)
        step(f"Mirrored {len(PUBLISH)} payloads into {SITE_DATA.relative_to(ROOT)}/")

    step(f"Published {len(PUBLISH)} files from {PUBLIC_DATA.relative_to(ROOT)}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
