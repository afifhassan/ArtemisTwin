#!/usr/bin/env python3
"""Stage 1 — DEM acquisition manifest.

Downloads the planetary DEMs named in the brief when they fit inside an explicit
size budget, and records a truthful status when they do not. Earth terrain is
served by the cached Terrarium tile stage (``derive_slope_roughness.py``) because
NASADEM/Copernicus COGs need rasterio + Earthdata and are not redistributable as
raw files from this build.

Usage
-----
    python scripts/download_dems.py                 # probe only (safe default)
    python scripts/download_dems.py --download --max-mb 250
    python scripts/download_dems.py --allow-large   # permit the >1 GB mosaics
"""
from __future__ import annotations

import argparse
import json
import os
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path

from common import (
    DERIVED,
    RAW_DEMS,
    ROOT,
    banner,
    env,
    jwt_expiry,
    sha256_file,
    step,
    utc_now_iso,
    warn,
    write_json,
)

PLANETARY = [
    {
        "id": "moon_lola_118m",
        "body": "Moon",
        "product": "LRO LOLA Global LDEM 118 m (Mar 2014)",
        "url": "https://planetarymaps.usgs.gov/mosaic/Moon_LRO_LOLA_Global_LDEM_118m_Mar2014.tif",
        "product_page": "https://astrogeology.usgs.gov/search/map/moon_lro_lola_global_ldem_118m",
        "path": RAW_DEMS / "moon_lola_118m.tif",
        "citation": "Smith et al. (2010), LRO LOLA; USGS Astrogeology mosaic.",
    },
    {
        "id": "mars_mola_463m",
        "body": "Mars",
        "product": "MGS MOLA DEM 463 m",
        "url": "https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_geotiff/Mars_MGS_MOLA_DEM_463m.tif",
        "product_page": "https://astrogeology.usgs.gov/search/?q=MOLA%20DEM%20463",
        "path": RAW_DEMS / "mars_mola_463m.tif",
        "citation": "Smith et al. (2001), MGS MOLA; USGS Astrogeology mosaic.",
    },
]


def probe(url: str, timeout: int = 30) -> dict:
    """Return size/status without downloading the body (HEAD, then Range).

    Some public science hosts use certificate chains that the local Windows store
    does not trust. A second, explicitly-labelled unverified probe distinguishes a
    TLS-chain problem from a dead endpoint; it is only a size probe and any real
    download still records a SHA-256.
    """
    insecure = ssl.create_default_context()
    insecure.check_hostname = False
    insecure.verify_mode = ssl.CERT_NONE

    def attempt(method: str, verify: bool) -> dict:
        headers = {"User-Agent": "ArtemisTwin-ETL/0.9"}
        if method == "GET":
            headers["Range"] = "bytes=0-0"
        req = urllib.request.Request(url, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout, context=None if verify else insecure) as res:
            size = res.headers.get("Content-Length")
            cr = res.headers.get("Content-Range", "")
            if method == "GET" and "/" in cr and cr.rsplit("/", 1)[-1].isdigit():
                size = cr.rsplit("/", 1)[-1]
            return {
                "http_status": int(getattr(res, "status", 200)),
                "bytes": int(size) if size and size.isdigit() else None,
                "method": method,
                "tls_verified": verify,
            }

    errors = []
    for verify in (True, False):
        for method in ("HEAD", "GET"):
            try:
                return attempt(method, verify)
            except urllib.error.HTTPError as exc:
                if exc.code in (401, 403, 404, 410):
                    return {
                        "http_status": exc.code,
                        "bytes": None,
                        "error": f"HTTP {exc.code}",
                        "tls_verified": verify,
                        "retired": exc.code in (404, 410),
                    }
                errors.append(f"{method}(verify={verify}): HTTP {exc.code}")
            except Exception as exc:
                errors.append(f"{method}(verify={verify}): {exc}")
    return {"http_status": None, "bytes": None, "error": " | ".join(errors), "tls_verified": None}


def download(url: str, dest: Path, expected: int | None) -> dict:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "ArtemisTwin-ETL/0.9"})
    started = time.time()
    with urllib.request.urlopen(req, timeout=120) as res, tmp.open("wb") as fh:
        total = expected or int(res.headers.get("Content-Length") or 0)
        read = 0
        next_report = 0
        while True:
            chunk = res.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
            read += len(chunk)
            pct = (read / total * 100.0) if total else 0.0
            if pct >= next_report:
                print(f"      {read/1e6:8.1f} MB  {pct:5.1f}%")
                next_report += 10
    os.replace(tmp, dest)
    return {
        "bytes": dest.stat().st_size,
        "sha256": sha256_file(dest),
        "seconds": round(time.time() - started, 1),
    }


def earthdata_dem(enabled: bool) -> dict:
    """Optional NASADEM / Copernicus GLO-30 pull when earthaccess is installed.

    Kept opt-in because it needs the Earthdata token plus a working `rasterio`
    stack, and because these products are large. The screening build uses the
    Terrarium sample when they are absent.
    """
    if not enabled:
        return {
            "status": "not_requested",
            "note": "Pass --earthdata-dem after installing earthaccess + rasterio to fetch NASADEM/COP-30 tiles.",
        }
    try:
        import earthaccess  # type: ignore
    except Exception as exc:
        return {"status": "dependency_missing", "error": f"{type(exc).__name__}: {exc}"}
    token = env("NASA_EARTHDATA_TOKEN")
    try:
        earthaccess.login(strategy="environment", token=token)
    except Exception as exc:
        return {"status": "auth_failed", "error": f"{type(exc).__name__}: {exc}"}
    bbox = (-68.5, -24.5, -67.5, -23.5)
    out: dict[str, dict] = {}
    for short_name, folder in [
        ("NASADEM_NC", "nasadem"),
        ("COP_DEM_GLO_30_DG", "copernicus_glo30"),
    ]:
        try:
            results = earthaccess.search_data(short_name=short_name, bounding_box=bbox)
            dest = ROOT / "data" / "earth_dems" / folder
            dest.mkdir(parents=True, exist_ok=True)
            files = earthaccess.download(results, local_path=str(dest)) if results else []
            out[short_name] = {
                "status": "downloaded" if files else "no_granules",
                "granules": len(results),
                "files": [str(Path(f).name) for f in files],
            }
        except Exception as exc:
            out[short_name] = {"status": "error", "error": f"{type(exc).__name__}: {exc}"}
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--download", action="store_true", help="download files inside the size budget")
    ap.add_argument("--max-mb", type=float, default=250.0, help="per-file budget for --download")
    ap.add_argument("--allow-large", action="store_true", help="ignore the size budget")
    ap.add_argument("--earthdata-dem", action="store_true", help="also try NASADEM/COP-30 via earthaccess")
    args = ap.parse_args()

    banner("Stage 1 · DEM acquisition")
    token = env("NASA_EARTHDATA_TOKEN")
    expiry = jwt_expiry(token)
    step(f"Earthdata user: {env('EARTHDATA_USER', 'unset')}")
    step(f"Earthdata token expires: {expiry or 'unknown'}")
    step("NASA API key is loaded from .env and is never written into site/ assets.")

    entries = []
    for item in PLANETARY:
        info = probe(item["url"])
        size_mb = (info["bytes"] / 1e6) if info.get("bytes") else None
        exists = item["path"].is_file()
        status = "present" if exists else "not_downloaded"
        note = ""
        if exists:
            note = "Cached file already present."
        elif info.get("retired"):
            status = "endpoint_retired"
            note = (
                f"Legacy URL returned HTTP {info['http_status']}. USGS reorganized its planetary map "
                f"service; download from the product page ({item['product_page']}) and place the file here."
            )
        elif info.get("error"):
            status = "probe_failed"
            note = "Endpoint did not respond; no file was created."
        elif size_mb is None:
            status = "size_unknown"
            note = "Server did not report a size; refusing an unbounded download."
        elif not args.allow_large and size_mb > args.max_mb:
            status = "skipped_size_budget"
            note = (
                f"{size_mb:.0f} MB exceeds the {args.max_mb:.0f} MB budget. "
                "Re-run with --allow-large on a machine with space, or point "
                "data/raw_dems at an existing copy."
            )
        elif args.download:
            print(f"    downloading {item['id']} ({size_mb:.0f} MB) …")
            got = download(item["url"], item["path"], info["bytes"])
            status = "downloaded"
            note = f"Downloaded {got['bytes']/1e6:.1f} MB in {got['seconds']} s."
            info.update(got)
        else:
            status = "available_not_downloaded"
            note = "Pass --download to fetch within the size budget."

        if status in {
            "skipped_size_budget",
            "available_not_downloaded",
            "probe_failed",
            "size_unknown",
            "endpoint_retired",
        }:
            warn(f"{item['id']}: {status} — {note}")

        entries.append(
            {
                "id": item["id"],
                "body": item["body"],
                "product": item["product"],
                "url": item["url"],
                "product_page": item["product_page"],
                "local_path": str(item["path"].relative_to(ROOT)).replace("\\", "/"),
                "status": status,
                "size_bytes": info.get("bytes"),
                "size_mb": round(size_mb, 1) if size_mb else None,
                "http_status": info.get("http_status"),
                "tls_verified": info.get("tls_verified"),
                "sha256": info.get("sha256") or (sha256_file(item["path"]) if exists else None),
                "checked": utc_now_iso(),
                "note": note,
                "citation": item["citation"],
            }
        )

    payload = {
        "schemaVersion": "1.0",
        "checked": utc_now_iso(),
        "earthdata_user": env("EARTHDATA_USER"),
        "earthdata_token_expires": expiry,
        "download_budget_mb": args.max_mb,
        "downloads": entries,
        "earthdata_dem": earthdata_dem(args.earthdata_dem),
        "earth_terrain_strategy": {
            "primary": "AWS Terrain Tiles (Terrarium) sampled per 2 × 2 km site window",
            "why": "Public, keyless, cacheable and adequate for footprint-scale slope/TRI. NASADEM_NC and COP_DEM_GLO_30_DG remain the preferred products once earthaccess/rasterio are installed.",
            "upgrade_path": "pip install earthaccess rasterio && python scripts/download_dems.py --earthdata-dem",
        },
    }
    write_json(DERIVED / "dem_manifest.json", payload)
    step(f"Wrote {DERIVED / 'dem_manifest.json'}")
    print(json.dumps({"statuses": {e["id"]: e["status"] for e in entries}}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
