#!/usr/bin/env python3
"""Stage 3c — LRO Diviner thermal context.

The global Diviner maximum-temperature raster is a multi-gigabyte PDS image.
This stage probes its size and label, downloads only when it fits an explicit
budget, and otherwise records the published thermal context used for the
screening envelopes. It never invents a lunar measurement.

Usage
-----
    python scripts/diviner_lunar_temp.py
    python scripts/diviner_lunar_temp.py --download --max-mb 400
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

import numpy as np

from common import (
    DERIVED,
    RAW_DEMS,
    banner,
    http_get,
    step,
    utc_now_iso,
    warn,
    write_json,
)

IMG_URL = "https://pds-geosciences.wustl.edu/lro/lro-l-diviner-6-clr-v1/lrodv_8001/data/gds_tmax_global_128.img"
LBL_URL = "https://pds-geosciences.wustl.edu/lro/lro-l-diviner-6-clr-v1/lrodv_8001/data/gds_tmax_global_128.lbl"


def probe_size(url: str) -> int | None:
    try:
        _, _, headers = http_get(url, timeout=30, retries=1, headers={"Range": "bytes=0-0"})
        cr = headers.get("Content-Range", "")
        if "/" in cr and cr.rsplit("/", 1)[-1].isdigit():
            return int(cr.rsplit("/", 1)[-1])
        cl = headers.get("Content-Length")
        return int(cl) if cl and cl.isdigit() else None
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--download", action="store_true")
    ap.add_argument("--max-mb", type=float, default=400.0)
    args = ap.parse_args()

    banner("Stage 3c · LRO Diviner thermal context")
    result = {
        "schemaVersion": "1.0",
        "generated": utc_now_iso(),
        "product": "LRO Diviner Level 3 global maximum temperature (gds_tmax_global_128)",
        "url": IMG_URL,
        "label_url": LBL_URL,
        "status": "probed",
        "published_context": {
            "note": "Published Diviner results describe the Moon's global surface temperature range as roughly 40 K in permanently shadowed polar terrain to about 400 K at the sub-solar point near noon.",
            "source": "Williams et al. (2017), Icarus 283, 300-325, doi:10.1016/j.icarus.2016.08.012",
            "use": "Context for the target envelopes only. This build does not claim a site-specific Diviner measurement.",
        },
    }

    label_path = RAW_DEMS / "diviner_tmax_global.lbl"
    try:
        _, body, _ = http_get(LBL_URL, timeout=45, retries=2)
        label_path.parent.mkdir(parents=True, exist_ok=True)
        label_path.write_bytes(body)
        text = body.decode("latin-1", "replace")
        for key in ("LINES", "LINE_SAMPLES", "SAMPLE_TYPE", "SAMPLE_BITS", "UNIT"):
            match = re.search(rf"^\s*{key}\s*=\s*([^\r\n]+)", text, re.MULTILINE)
            if match:
                result[key.lower()] = match.group(1).strip()
        step(f"PDS label saved ({len(body)} bytes)")
    except Exception as exc:
        result["label_error"] = str(exc)
        warn(f"Diviner label unavailable: {exc}")

    size = probe_size(IMG_URL)
    size_mb = size / 1e6 if size else None
    result["raster_bytes"] = size
    result["raster_mb"] = round(size_mb, 1) if size_mb else None

    if size_mb is None:
        result["status"] = "endpoint_unavailable"
        result["note"] = (
            "The legacy PDS path cited in the brief no longer resolves (label and raster returned 404). "
            "Published Diviner thermal context is recorded above; no raster measurement is claimed. "
            "Use the current PDS Diviner bundle or the Diviner Data Portal to enable raster statistics."
        )
        warn(result["note"])
    elif size_mb > args.max_mb and not args.download:
        result["status"] = "skipped_size_budget"
        result["note"] = f"{size_mb:.0f} MB exceeds the {args.max_mb:.0f} MB budget. Published context is used instead."
        warn(result["note"])
    elif not args.download:
        result["status"] = "available_not_downloaded"
        result["note"] = "Pass --download to fetch this raster."
    else:
        dest = RAW_DEMS / "diviner_tmax_global.img"
        print(f"    downloading {size_mb:.0f} MB …")
        _, blob, _ = http_get(IMG_URL, timeout=600, retries=2)
        dest.write_bytes(blob)
        result["raster_path"] = str(dest.relative_to(RAW_DEMS.parent.parent))
        try:
            dtype = np.float32 if "FLOAT" in str(result.get("sample_type", "")).upper() else np.int16
            arr = np.frombuffer(blob, dtype=dtype)
            valid = arr[np.isfinite(arr)] if dtype == np.float32 else arr[arr > 0]
            if valid.size:
                result["status"] = "computed"
                result["raster_stats"] = {
                    "min": float(valid.min()),
                    "max": float(valid.max()),
                    "min_c": round(float(valid.min()) - 273.15, 2),
                    "max_c": round(float(valid.max()) - 273.15, 2),
                    "samples": int(valid.size),
                    "dtype": str(dtype),
                }
        except Exception as exc:
            result["status"] = "downloaded_unparsed"
            result["parse_error"] = str(exc)

    write_json(DERIVED / "diviner_status.json", result)
    step(f"Wrote {DERIVED / 'diviner_status.json'} (status: {result['status']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
