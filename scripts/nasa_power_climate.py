#!/usr/bin/env python3
"""Stage 3 — NASA POWER climatology for the seven Earth screening windows.

Real, keyless NASA POWER observations (MERRA-2 based climatology) are cached for
30 days and converted into the layer values used by the screening model. Every
value keeps its parameter id, unit and retrieval timestamp.

Notes on honesty
----------------
* ``TS`` is Earth *skin* temperature, a proxy for surface radiant temperature —
  not a MODIS LST retrieval. It is flagged ``proxy`` in the model.
* Warm/cold values are the warmest/coldest **monthly means** in the climatology,
  so they understate true hourly extremes.
* Ice, mineralogy, rock abundance, cave proximity and access are not available
  from POWER and are deliberately left missing.

Usage
-----
    python scripts/nasa_power_climate.py
    python scripts/nasa_power_climate.py --site atacama --max-age-days 0
"""
from __future__ import annotations

import argparse
import urllib.parse

from common import (
    DERIVED,
    banner,
    cached_json,
    read_json,
    step,
    utc_now_iso,
    warn,
    write_json,
)
from config import SITES

PARAMS = [
    "TS",
    "T2M",
    "T2M_MAX",
    "T2M_MIN",
    "PS",
    "ALLSKY_SFC_SW_DWN",
    "WS2M",
    "PRECTOTCORR",
    "RH2M",
    "AOD_55",
]
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def _clean(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return None if value <= -900 else value


def power_url(lat: float, lon: float) -> str:
    query = urllib.parse.urlencode(
        {
            "parameters": ",".join(PARAMS),
            "community": "RE",
            "longitude": f"{lon:.6f}",
            "latitude": f"{lat:.6f}",
            "format": "JSON",
        }
    )
    return f"https://power.larc.nasa.gov/api/temporal/climatology/point?{query}"


def derive(payload: dict) -> dict:
    props = payload.get("properties", {})
    param = props.get("parameter", {})
    meta = props.get("parameters", {})

    def monthly(key: str) -> dict[str, float | None]:
        return {m: _clean(param.get(key, {}).get(m)) for m in MONTHS}

    ts = monthly("TS")
    ts_vals = [v for v in ts.values() if v is not None]
    warm = max(ts_vals) if ts_vals else None
    cold = min(ts_vals) if ts_vals else None
    warm_month = max(ts, key=lambda m: ts[m]) if ts_vals else None
    cold_month = min(ts, key=lambda m: ts[m]) if ts_vals else None

    ann = {k: _clean(v.get("ANN")) if isinstance(v, dict) else None for k, v in param.items()}

    solar_kwh = ann.get("ALLSKY_SFC_SW_DWN")
    solar_wm2 = round(solar_kwh * 1000.0 / 24.0, 2) if solar_kwh is not None else None
    aod = ann.get("AOD_55")
    rain_mm_day = ann.get("PRECTOTCORR")

    values = {
        "L4_temp_max": round(warm, 2) if warm is not None else None,
        "L4_temp_min": round(cold, 2) if cold is not None else None,
        "L4_temp_mean": round(ann["TS"], 2) if ann.get("TS") is not None else None,
        "L4_air_temp_max_mean": round(ann["T2M_MAX"], 2) if ann.get("T2M_MAX") is not None else None,
        "L4_air_temp_min_mean": round(ann["T2M_MIN"], 2) if ann.get("T2M_MIN") is not None else None,
        "L5_solar_mean": solar_wm2,
        "L5_solar_kwh_m2_day": round(solar_kwh, 3) if solar_kwh is not None else None,
        "L6_pressure_mean": round(ann["PS"], 2) if ann.get("PS") is not None else None,
        "L9_dust_idx": round(min(1.0, max(0.0, aod / 0.8)), 3) if aod is not None else None,
        "L9_aod_550": round(aod, 3) if aod is not None else None,
        "wind_ms": round(ann["WS2M"], 2) if ann.get("WS2M") is not None else None,
        "rain_mm_day": round(rain_mm_day, 3) if rain_mm_day is not None else None,
        "rain_mm_year": round(rain_mm_day * 365.25, 1) if rain_mm_day is not None else None,
        "rh_pct": round(ann["RH2M"], 1) if ann.get("RH2M") is not None else None,
        "air_temp_mean": round(ann["T2M"], 2) if ann.get("T2M") is not None else None,
    }

    return {
        "values": values,
        "warm_month": warm_month,
        "cold_month": cold_month,
        "monthly_ts": ts,
        "units": {
            "TS": meta.get("TS", {}).get("units", "C"),
            "PS": meta.get("PS", {}).get("units", "kPa"),
            "ALLSKY_SFC_SW_DWN": meta.get("ALLSKY_SFC_SW_DWN", {}).get("units", "kWh/m^2/day"),
            "AOD_55": meta.get("AOD_55", {}).get("units", "dimensionless"),
            "PRECTOTCORR": meta.get("PRECTOTCORR", {}).get("units", "mm/day"),
        },
        "title": props.get("title"),
        "header": payload.get("header", {}),
        "messages": payload.get("messages", []),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--site", action="append", help="limit to one or more site ids")
    ap.add_argument("--max-age-days", type=float, default=30.0)
    args = ap.parse_args()

    banner("Stage 3 · NASA POWER climatology")
    selected = [s for s in SITES if not args.site or s["site_id"] in args.site]
    previous = (read_json(DERIVED / "earth_climate.json", {}) or {}).get("sites", {})
    sites: dict[str, dict] = {}

    for site in selected:
        sid = site["site_id"]
        url = power_url(site["lat"], site["lon"])
        try:
            payload, prov = cached_json(url, max_age_days=args.max_age_days)
            derived = derive(payload)
            values = derived["values"]
            missing = [k for k in ("L4_temp_max", "L5_solar_mean", "L6_pressure_mean", "L9_dust_idx") if values.get(k) is None]
            sites[sid] = {
                "site_id": sid,
                "status": "ok" if not missing else "partial",
                "values": values,
                "warm_month": derived["warm_month"],
                "cold_month": derived["cold_month"],
                "monthly_ts": derived["monthly_ts"],
                "units": derived["units"],
                "missing": missing,
                "provenance": {
                    **prov,
                    "dataset": "NASA POWER climatology (MERRA-2), community RE, 2001–2020 normals",
                    "parameters": PARAMS,
                    "note": "TS is skin temperature used as a surface-temperature proxy; monthly means smooth extremes.",
                },
            }
            step(
                f"{sid:18s} TS {values['L4_temp_min']:6.1f} … {values['L4_temp_max']:6.1f} °C · "
                f"solar {values['L5_solar_mean']:6.1f} W/m² · PS {values['L6_pressure_mean']:6.1f} kPa · "
                f"AOD {values['L9_aod_550']}"
            )
        except Exception as exc:
            warn(f"{sid}: POWER request failed — {exc}")
            if sid in previous:
                sites[sid] = {**previous[sid], "status": "stale_cached", "error": str(exc)}
                warn(f"{sid}: re-using the previous climatology.")
            else:
                sites[sid] = {"site_id": sid, "status": "error", "error": str(exc), "values": {}}

    payload = {
        "schemaVersion": "1.0",
        "generated": utc_now_iso(),
        "endpoint": "https://power.larc.nasa.gov/api/temporal/climatology/point",
        "community": "RE",
        "parameters": PARAMS,
        "sites": sites,
    }
    write_json(DERIVED / "earth_climate.json", payload)
    ok = sum(1 for v in sites.values() if v.get("status") in {"ok", "partial"})
    step(f"Wrote {DERIVED / 'earth_climate.json'} ({ok}/{len(sites)} sites current)")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
