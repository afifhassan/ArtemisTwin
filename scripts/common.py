"""Shared utilities for the ArtemisTwin offline ETL pipeline.

Design rules
------------
* Standard library + numpy only. GDAL/rasterio/earthaccess are optional and are
  detected at runtime; every stage has a documented, deterministic fallback.
* Every remote value is cached under ``data/cache`` with its URL, retrieval time
  and SHA-256, so a later run can be reproduced without the network.
* No module writes into ``site/data`` directly. ``scripts/export_data.py`` is the
  single publication step.
"""
from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
PUBLIC_DATA = ROOT / "public" / "data"
SITE = ROOT / "site"
SITE_DATA = SITE / "data"
DATA = ROOT / "data"
CACHE = DATA / "cache"
DERIVED = DATA / "derived"
RAW_DEMS = DATA / "raw_dems"
EARTH_DEMS = DATA / "earth_dems"
TERRARIUM = EARTH_DEMS / "terrarium"

for _p in (PUBLIC_DATA, SITE_DATA, CACHE, DERIVED, RAW_DEMS, EARTH_DEMS, TERRARIUM):
    _p.mkdir(parents=True, exist_ok=True)

UA = "ArtemisTwin-ETL/0.9 (NASA Space Apps; research screening tool)"
TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
WEB_MERCATOR_R = 6378137.0
WEB_MERCATOR_CIRCUMFERENCE = 2.0 * math.pi * WEB_MERCATOR_R
EARTH_RADIUS_M = 6371008.8


# --------------------------------------------------------------------------- #
# Environment
# --------------------------------------------------------------------------- #
def load_env(path: Path | None = None) -> dict[str, str]:
    """Minimal .env loader (python-dotenv is optional, not required)."""
    path = path or (ROOT / ".env")
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        values[key] = val
        os.environ.setdefault(key, val)
    return values


def env(key: str, default: str | None = None) -> str | None:
    if not os.environ.get("_AT_ENV_LOADED"):
        load_env()
        os.environ["_AT_ENV_LOADED"] = "1"
    return os.environ.get(key, default)


def jwt_expiry(token: str | None) -> str | None:
    """Read the exp claim without verifying the signature (provenance only)."""
    if not token or token.count(".") != 2:
        return None
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
        exp = claims.get("exp")
        if not exp:
            return None
        return datetime.fromtimestamp(int(exp), tz=timezone.utc).isoformat()
    except Exception:
        return None


# --------------------------------------------------------------------------- #
# HTTP with retries + on-disk cache
# --------------------------------------------------------------------------- #
def _cache_path(url: str, suffix: str = ".bin") -> Path:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]
    return CACHE / "http" / f"{digest}{suffix}"


def http_get(
    url: str,
    *,
    timeout: int = 60,
    retries: int = 3,
    headers: dict[str, str] | None = None,
    allow_status: Iterable[int] = (),
) -> tuple[int, bytes, dict[str, str]]:
    """GET bytes with bounded exponential backoff. Raises on final failure."""
    hdrs = {"User-Agent": UA, "Accept": "*/*"}
    if headers:
        hdrs.update(headers)
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as res:
                body = res.read()
                status = int(getattr(res, "status", 200))
                return status, body, dict(res.headers)
        except urllib.error.HTTPError as exc:
            if exc.code in allow_status:
                return exc.code, exc.read(), dict(exc.headers or {})
            last = exc
            # 4xx other than 429 is not worth retrying.
            if 400 <= exc.code < 500 and exc.code != 429:
                break
        except Exception as exc:  # socket timeouts, TLS, DNS, reset
            last = exc
        time.sleep(min(8.0, 1.2 * (2**attempt)))
    raise RuntimeError(f"GET failed after {retries} attempts: {url} :: {last}")


def http_get_json(url: str, *, timeout: int = 60, retries: int = 3) -> Any:
    _, body, _ = http_get(url, timeout=timeout, retries=retries)
    return json.loads(body)


def fetch_cached(
    url: str,
    *,
    suffix: str = ".bin",
    max_age_days: float = 3650.0,
    timeout: int = 90,
    retries: int = 3,
) -> bytes:
    """Return cached bytes when fresh; otherwise download and cache atomically."""
    path = _cache_path(url, suffix)
    meta_path = path.with_suffix(path.suffix + ".json")
    if path.is_file() and meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            age_days = (time.time() - float(meta.get("retrieved_unix", 0))) / 86400.0
            if age_days <= max_age_days:
                return path.read_bytes()
        except Exception:
            pass
    status, body, headers = http_get(url, timeout=timeout, retries=retries)
    if status >= 400:
        raise RuntimeError(f"HTTP {status} for {url}")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(body)
    os.replace(tmp, path)
    meta_path.write_text(
        json.dumps(
            {
                "url": url,
                "status": status,
                "bytes": len(body),
                "sha256": hashlib.sha256(body).hexdigest(),
                "retrieved": utc_now_iso(),
                "retrieved_unix": time.time(),
                "content_type": headers.get("Content-Type", ""),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return body


# --------------------------------------------------------------------------- #
# Files
# --------------------------------------------------------------------------- #
def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_bytes(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except json.JSONDecodeError as exc:
        print(f"  ! invalid JSON {path}: {exc}", file=sys.stderr)
        return default


def write_json(path: Path, payload: Any, *, indent: int = 2) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=indent, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, path)


def banner(text: str) -> None:
    print(f"\n=== {text} ===")


def step(text: str) -> None:
    print(f"  · {text}")


def warn(text: str) -> None:
    print(f"  ! {text}", file=sys.stderr)


# --------------------------------------------------------------------------- #
# Geometry / geodesy
# --------------------------------------------------------------------------- #
def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def bbox_around(lat: float, lon: float, half_km: float) -> dict[str, float]:
    dlat = half_km / 110.574
    dlon = half_km / (111.320 * max(0.05, math.cos(math.radians(lat))))
    return {"south": lat - dlat, "north": lat + dlat, "west": lon - dlon, "east": lon + dlon}


def ring_around(lat: float, lon: float, half_km: float, steps: int = 24) -> list[list[float]]:
    """A 2*half_km square ring (lon, lat) used for the published GeoJSON footprint."""
    bb = bbox_around(lat, lon, half_km)
    ring = [
        [bb["west"], bb["south"]],
        [bb["east"], bb["south"]],
        [bb["east"], bb["north"]],
        [bb["west"], bb["north"]],
        [bb["west"], bb["south"]],
    ]
    return ring


# --------------------------------------------------------------------------- #
# Web-Mercator terrain tiles (Terrarium PNG)
# --------------------------------------------------------------------------- #
def lonlat_to_pixel(lat: float, lon: float, zoom: int) -> tuple[float, float]:
    n = 2**zoom * 256.0
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(max(-85.05112878, min(85.05112878, lat)))
    y = (1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n
    return x, y


def pixel_to_lonlat(x: float, y: float, zoom: int) -> tuple[float, float]:
    n = 2**zoom * 256.0
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * y / n))))
    return lat, lon


def _png_chunks(blob: bytes):
    if blob[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos = 8
    while pos + 8 <= len(blob):
        (length,) = struct.unpack(">I", blob[pos : pos + 4])
        ctype = blob[pos + 4 : pos + 8]
        data = blob[pos + 8 : pos + 8 + length]
        yield ctype, data
        pos += 12 + length


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def decode_png_rgb(blob: bytes) -> np.ndarray:
    """Decode a non-interlaced 8-bit PNG to HxWxC uint8 (no Pillow dependency)."""
    width = height = bit_depth = color_type = interlace = None
    idat = bytearray()
    for ctype, data in _png_chunks(blob):
        if ctype == b"IHDR":
            width, height, bit_depth, color_type, _comp, _filt, interlace = struct.unpack(">IIBBBBB", data)
        elif ctype == b"IDAT":
            idat += data
        elif ctype == b"IEND":
            break
    if None in (width, height) or bit_depth != 8 or interlace != 0:
        raise ValueError("unsupported PNG (need 8-bit, non-interlaced)")
    channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(color_type)
    if channels is None:
        raise ValueError(f"unsupported PNG colour type {color_type}")
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    bpp = channels
    out = bytearray(height * stride)
    prev = bytearray(stride)
    pos = 0
    for y in range(height):
        if pos >= len(raw):
            raise ValueError("truncated PNG scanlines")
        ftype = raw[pos]
        pos += 1
        line = bytearray(raw[pos : pos + stride])
        if len(line) != stride:
            raise ValueError("truncated PNG scanline")
        pos += stride
        if ftype == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ftype == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                upleft = prev[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + _paeth(left, prev[i], upleft)) & 0xFF
        elif ftype != 0:
            raise ValueError(f"unsupported PNG filter {ftype}")
        out[y * stride : (y + 1) * stride] = line
        prev = line
    return np.frombuffer(bytes(out), dtype=np.uint8).reshape(height, width, channels)


def _terrarium_tile(z: int, x: int, y: int) -> np.ndarray:
    url = TERRARIUM_URL.format(z=z, x=x, y=y)
    path = TERRARIUM / str(z) / str(x) / f"{y}.png"
    if path.is_file() and path.stat().st_size > 0:
        blob = path.read_bytes()
    else:
        blob = fetch_cached(url, suffix=".png", max_age_days=3650, timeout=90)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(blob)
    rgb = decode_png_rgb(blob).astype(np.float64)
    # Mapzen Terrarium encoding: R*256 + G + B/256 - 32768 metres.
    return rgb[:, :, 0] * 256.0 + rgb[:, :, 1] + rgb[:, :, 2] / 256.0 - 32768.0


def terrain_window(lat: float, lon: float, half_km: float = 1.0, *, zoom: int = 14, samples: int = 161):
    """Sample a real 2*half_km terrain window from public Terrarium tiles.

    Returns (metrics, grid, lon_grid, lat_grid). Tiles are cached on disk.
    """
    bb = bbox_around(lat, lon, half_km)
    x0, y0 = lonlat_to_pixel(bb["north"], bb["west"], zoom)
    x1, y1 = lonlat_to_pixel(bb["south"], bb["east"], zoom)
    tx0, tx1 = int(x0 // 256), int(x1 // 256)
    ty0, ty1 = int(y0 // 256), int(y1 // 256)
    tiles_x = tx1 - tx0 + 1
    tiles_y = ty1 - ty0 + 1
    if tiles_x * tiles_y > 64:
        raise ValueError("terrain window spans too many tiles")

    mosaic = np.zeros((tiles_y * 256, tiles_x * 256), dtype=np.float64)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            tile = _terrarium_tile(zoom, tx, ty)
            mosaic[(ty - ty0) * 256 : (ty - ty0 + 1) * 256, (tx - tx0) * 256 : (tx - tx0 + 1) * 256] = tile

    xs = np.linspace(x0, x1, samples)
    ys = np.linspace(y0, y1, samples)
    gx = xs - tx0 * 256
    gy = ys - ty0 * 256
    # Bilinear interpolation inside the mosaic.
    ix = np.clip(np.floor(gx).astype(int), 0, mosaic.shape[1] - 2)
    iy = np.clip(np.floor(gy).astype(int), 0, mosaic.shape[0] - 2)
    fx = np.clip(gx - ix, 0, 1)
    fy = np.clip(gy - iy, 0, 1)
    z = (
        mosaic[np.ix_(iy, ix)] * (1 - fx)[None, :] * (1 - fy)[:, None]
        + mosaic[np.ix_(iy, ix + 1)] * fx[None, :] * (1 - fy)[:, None]
        + mosaic[np.ix_(iy + 1, ix)] * (1 - fx)[None, :] * fy[:, None]
        + mosaic[np.ix_(iy + 1, ix + 1)] * fx[None, :] * fy[:, None]
    )
    z = np.where(np.abs(z + 32768.0) < 1e-6, np.nan, z)
    if not np.isfinite(z).any():
        raise ValueError("terrain window contains only nodata")

    lat_grid, lon_grid = np.meshgrid(
        np.linspace(bb["north"], bb["south"], samples),
        np.linspace(bb["west"], bb["east"], samples),
        indexing="ij",
    )
    # Ground size of one sample step (metres), using local geodesy.
    step_y = (2 * half_km * 1000.0) / (samples - 1)
    step_x = (2 * half_km * 1000.0) / (samples - 1)
    cell_m = float((step_x + step_y) / 2.0)

    slope, tri = slope_tri(z, cell_m, cell_m)

    def _finite_stat(arr: np.ndarray, fn, digits: int = 2):
        vals = arr[np.isfinite(arr)]
        if vals.size == 0:
            return None
        return round(float(fn(vals)), digits)

    row_mid = z[samples // 2, :]
    step = max(1, samples // 48)
    profile = [round(float(v), 1) for v in row_mid[::step]][:49]
    if len(profile) < 49:
        profile.append(profile[-1])

    metrics = {
        "elevation_mean_m": _finite_stat(z, np.mean, 1),
        "elevation_min_m": _finite_stat(z, np.min, 1),
        "elevation_max_m": _finite_stat(z, np.max, 1),
        "relief_m": _finite_stat(z, lambda v: v.max() - v.min(), 1),
        "slope_mean_deg": _finite_stat(slope, np.mean, 2),
        "slope_p95_deg": _finite_stat(slope, lambda v: np.percentile(v, 95), 2),
        "slope_max_deg": _finite_stat(slope, np.max, 2),
        "tri_mean": _finite_stat(tri, np.mean, 3),
        "tri_p95": _finite_stat(tri, lambda v: np.percentile(v, 95), 3),
        "tri_max": _finite_stat(tri, np.max, 3),
        "cell_m": round(cell_m, 2),
        "grid": f"{samples}x{samples}",
        "source": "AWS Terrain Tiles (Terrarium), z%d; mixed SRTM/3DEP/ASTER/ETOPO1 composite" % zoom,
        "source_url": TERRARIUM_URL.format(z=zoom, x=tx0, y=ty0),
        "tiles": tiles_x * tiles_y,
        "profile_ew_m": profile,
        "profile_step_m": round(step * cell_m, 1),
        "window_km": round(2 * half_km, 3),
        "center": [round(lat, 6), round(lon, 6)],
        "bbox": {k: round(v, 6) for k, v in bb.items()},
    }
    return metrics, z, lon_grid, lat_grid


def slope_tri(z: np.ndarray, cell_x: float, cell_y: float):
    """Horn (1981) slope in degrees and Riley et al. (1999) TRI (dimensionless)."""
    zp = np.pad(z, 1, mode="edge")
    z1 = zp[0:-2, 0:-2]
    z2 = zp[0:-2, 1:-1]
    z3 = zp[0:-2, 2:]
    z4 = zp[1:-1, 0:-2]
    z6 = zp[1:-1, 2:]
    z7 = zp[2:, 0:-2]
    z8 = zp[2:, 1:-1]
    z9 = zp[2:, 2:]
    dzdx = ((z3 + 2 * z6 + z9) - (z1 + 2 * z4 + z7)) / (8.0 * cell_x)
    dzdy = ((z7 + 2 * z8 + z9) - (z1 + 2 * z2 + z3)) / (8.0 * cell_y)
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    center = z
    sq = (
        (z1 - center) ** 2
        + (z2 - center) ** 2
        + (z3 - center) ** 2
        + (z4 - center) ** 2
        + (z6 - center) ** 2
        + (z7 - center) ** 2
        + (z8 - center) ** 2
        + (z9 - center) ** 2
    )
    tri = np.sqrt(sq) / max(1e-6, (cell_x + cell_y) / 2.0)
    return slope, tri


# --------------------------------------------------------------------------- #
# Cached JSON with provenance
# --------------------------------------------------------------------------- #
def cached_json(url: str, *, max_age_days: float = 30.0, timeout: int = 60) -> tuple[Any, dict[str, Any]]:
    """Fetch JSON through the HTTP cache and return (payload, provenance)."""
    blob = fetch_cached(url, suffix=".json", max_age_days=max_age_days, timeout=timeout)
    meta_path = _cache_path(url, ".json").with_suffix(".json.json")
    meta = read_json(meta_path, {}) or {}
    return json.loads(blob), {
        "url": url,
        "retrieved": meta.get("retrieved", utc_now_iso()),
        "sha256": meta.get("sha256", sha256_bytes(blob)),
        "cached": True,
    }
