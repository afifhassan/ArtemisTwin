#!/usr/bin/env python3
"""Stage 4 — combine terrain and climate into site records + GeoJSON footprints.

Outputs
-------
public/data/earth_analog_sites.geojson   2 × 2 km screening footprints (EPSG:4326)
public/data/sites_extracted.csv          flat table used by the scoring engine
data/derived/site_records.json           full records incl. E–W profile

Every record states which layers are present and which are missing. Missing is
never written as zero: the CSV cell stays empty and the layer is named.

Usage
-----
    python scripts/zonal_stats_extractor.py
"""
from __future__ import annotations

import csv
import json

from common import (
    DERIVED,
    PUBLIC_DATA,
    banner,
    read_json,
    ring_around,
    step,
    utc_now_iso,
    warn,
    write_json,
    write_text,
)
from config import LAYERS, SCORED_KEYS, SITE_COLUMNS, SITES

CSV_FIELDS = [
    "site_id",
    "site_name",
    "country",
    "region",
    "catalog_id",
    "lat",
    "lon",
    "window_km",
    *SITE_COLUMNS.values(),
    "L1_elevation_mean_m",
    "L1_elevation_min_m",
    "L1_elevation_max_m",
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


def build_record(site: dict, terrain: dict, climate: dict) -> dict:
    values = climate.get("values", {}) if climate else {}
    record = {
        "site_id": site["site_id"],
        "site_name": site["site_name"],
        "country": site["country"],
        "region": site.get("region"),
        "catalog_id": site.get("catalog_id"),
        "lat": site["lat"],
        "lon": site["lon"],
        "half_km": site["half_km"],
        "window_km": round(site["half_km"] * 2, 3),
        "window_label": site.get("window_label"),
        "note": site.get("note"),
        "L1_relief_m": terrain.get("relief_m"),
        "L1_elevation_mean_m": terrain.get("elevation_mean_m"),
        "L1_elevation_min_m": terrain.get("elevation_min_m"),
        "L1_elevation_max_m": terrain.get("elevation_max_m"),
        "L2_slope_mean": terrain.get("slope_mean_deg"),
        "L2_slope_p95": terrain.get("slope_p95_deg"),
        "L3_roughness_mean": terrain.get("tri_mean"),
        "L3_roughness_p95": terrain.get("tri_p95"),
        "L4_temp_max": values.get("L4_temp_max"),
        "L4_temp_min": values.get("L4_temp_min"),
        "L4_temp_mean": values.get("L4_temp_mean"),
        "L4_warm_month": climate.get("warm_month") if climate else None,
        "L4_cold_month": climate.get("cold_month") if climate else None,
        "L5_solar_mean": values.get("L5_solar_mean"),
        "L6_pressure_mean": values.get("L6_pressure_mean"),
        "L7_ice_moisture_mean": None,
        "L8_mineral_idx": None,
        "L9_dust_idx": values.get("L9_dust_idx"),
        "L9_aod_550": values.get("L9_aod_550"),
        "L10_rock_abundance": None,
        "L11_cave_dist_km": None,
        "L12_access_road_km": None,
        "wind_ms": values.get("wind_ms"),
        "rain_mm_year": values.get("rain_mm_year"),
        "rh_pct": values.get("rh_pct"),
        "terrain_source": terrain.get("source"),
        "terrain_status": terrain.get("status"),
        "climate_status": climate.get("status") if climate else "unavailable",
        "profile_ew_m": terrain.get("profile_ew_m", []),
        "profile_step_m": terrain.get("profile_step_m"),
        "grid_cell_m": terrain.get("cell_m"),
        "terrain_bbox": terrain.get("bbox"),
    }

    present, missing = [], []
    for key in SCORED_KEYS + ["L12_access"]:
        col = SITE_COLUMNS[key]
        if record.get(col) is None:
            missing.append(key)
        else:
            present.append(key)

    # The brief counts 12 layers, with temperature max+min as one layer.
    groups = {
        "L1_elevation": ["L1_elevation"],
        "L2_slope": ["L2_slope"],
        "L3_roughness": ["L3_roughness"],
        "L4_temperature": ["L4_temperature_max", "L4_temperature_min"],
        "L5_solar_illumination": ["L5_solar_illumination"],
        "L6_surface_pressure": ["L6_surface_pressure"],
        "L7_ice_volatiles": ["L7_ice_volatiles"],
        "L8_mineralogy": ["L8_mineralogy"],
        "L9_dust_hazard": ["L9_dust_hazard"],
        "L10_rock_abundance": ["L10_rock_abundance"],
        "L11_cave_proximity": ["L11_cave_proximity"],
        "L12_access": ["L12_access"],
    }
    present_groups = [
        group for group, keys in groups.items() if all(record.get(SITE_COLUMNS[k]) is not None for k in keys)
    ]
    record["present_layers"] = present
    record["missing_layers"] = missing
    record["layers_present"] = len(present_groups)
    record["layers_total"] = len(groups)
    record["data_completeness_pct"] = round(100.0 * len(present_groups) / len(groups), 1)

    record["layer_sources"] = {
        "L1_elevation": terrain.get("source"),
        "L2_slope": "Derived: Horn 3×3 on Terrace DEM sample",
        "L3_roughness": "Derived: Riley et al. (1999) TRI",
        "L4_temperature_max": "NASA POWER TS climatology (proxy)",
        "L4_temperature_min": "NASA POWER TS climatology (proxy)",
        "L5_solar_illumination": "NASA POWER ALLSKY_SFC_SW_DWN (proxy)",
        "L6_surface_pressure": "NASA POWER PS (excluded from fit)",
        "L9_dust_hazard": "NASA POWER AOD_55 mapped to 0–1 (proxy)",
    }
    return record


def main() -> int:
    banner("Stage 4 · site records, zonal merge & GeoJSON")
    terrain_payload = read_json(DERIVED / "terrain_metrics.json", {}) or {}
    climate_payload = read_json(DERIVED / "earth_climate.json", {}) or {}
    terrains = terrain_payload.get("sites", {})
    climates = climate_payload.get("sites", {})

    records = []
    for site in SITES:
        sid = site["site_id"]
        terrain = terrains.get(sid, {})
        if terrain.get("status") != "ok":
            warn(f"{sid}: terrain status is {terrain.get('status', 'absent')} — terrain layers will be missing.")
        record = build_record(site, terrain, climates.get(sid, {}))
        records.append(record)

    write_json(DERIVED / "site_records.json", {"schemaVersion": "1.0", "generated": utc_now_iso(), "sites": records})

    # CSV (empty cells for genuinely missing layers).
    import io

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for rec in records:
        row = {k: rec.get(k) for k in CSV_FIELDS}
        row["present_layers"] = ";".join(rec["present_layers"])
        row["missing_layers"] = ";".join(rec["missing_layers"])
        writer.writerow({k: ("" if v is None else v) for k, v in row.items()})
    write_text(PUBLIC_DATA / "sites_extracted.csv", buf.getvalue())

    # GeoJSON footprints.
    features = []
    for rec in records:
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [ring_around(rec["lat"], rec["lon"], rec["half_km"])],
                },
                "properties": {
                    "site_id": rec["site_id"],
                    "site_name": rec["site_name"],
                    "country": rec["country"],
                    "region": rec["region"],
                    "catalog_id": rec["catalog_id"],
                    "role": "2 × 2 km screening window",
                    "window_label": rec["window_label"],
                    "centre_lat": rec["lat"],
                    "centre_lon": rec["lon"],
                    "window_km": rec["window_km"],
                    "data_completeness_pct": rec["data_completeness_pct"],
                    "terrain_source": rec["terrain_source"],
                    "note": "Footprint drawn around the screening window, not an official study boundary or land-access claim.",
                },
            }
        )
    geojson = {
        "type": "FeatureCollection",
        "name": "artemistwin_earth_analog_sites",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "metadata": {
            "generated": utc_now_iso(),
            "description": "2 × 2 km screening windows used by the provisional ArtemisTwin analog fit model.",
            "caveat": "Windows are analytical samples, not selected test sites, permitted areas or complete regional evidence.",
        },
        "features": features,
    }
    write_json(PUBLIC_DATA / "earth_analog_sites.geojson", geojson)

    step(f"Wrote {PUBLIC_DATA / 'earth_analog_sites.geojson'} ({len(features)} features)")
    step(f"Wrote {PUBLIC_DATA / 'sites_extracted.csv'}")
    for rec in records:
        step(f"{rec['site_id']:18s} completeness {rec['data_completeness_pct']:5.1f}% · missing {', '.join(rec['missing_layers'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
