#!/usr/bin/env python3
"""Stage 3b — AppEEARS MOD11A1 land-surface-temperature extractor.

The request/poll/download flow is complete, but a MODIS area extraction can take
minutes to hours and needs an accepted product EULA. It is therefore **opt-in**:
the default run only verifies the token and records that no task was submitted.
The website never calls AppEEARS; it reads the exported static payloads.

Usage
-----
    python scripts/appeears_lst_download.py                 # verify token only
    python scripts/appeears_lst_download.py --submit        # submit + poll + download
    python scripts/appeears_lst_download.py --task-id <id>  # resume an existing task
"""
from __future__ import annotations

import argparse
import io
import json
import os
import time

import urllib.error
import urllib.request

from common import (
    CACHE,
    DERIVED,
    ROOT,
    banner,
    env,
    step,
    utc_now_iso,
    warn,
    write_json,
)

API = "https://appeears.earthdatacloud.nasa.gov/api"
PRODUCT = "MOD11A1.061"
LAYERS = ["LST_Day_1km", "LST_Night_1km"]


def headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def request_json(method: str, path: str, token: str, payload: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, method=method, headers=headers(token))
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return int(getattr(res, "status", 200)), json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        return exc.code, {"error": body[:800]}


def task_payload() -> dict:
    return {
        "task_type": "area",
        "task_name": "ArtemisTwin_Earth_Analog_LST",
        "params": {
            "dates": [{"startDate": "01-01-2024", "endDate": "12-31-2024"}],
            "layers": [{"product": PRODUCT, "layer": layer} for layer in LAYERS],
            "geo": {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [
                                [
                                    [-68.52, -24.52],
                                    [-67.44, -24.52],
                                    [-67.44, -23.20],
                                    [-68.52, -23.20],
                                    [-68.52, -24.52],
                                ]
                            ],
                        },
                    }
                ],
            },
            "output": {"format": {"type": "geotiff"}, "projection": "geographic"},
        },
    }


def download_bundle(task_id: str, token: str, out_dir) -> list[dict]:
    status, bundle = request_json("GET", f"/bundle/{task_id}", token)
    if status != 200:
        raise RuntimeError(f"bundle request failed: {status} {bundle}")
    out_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for item in bundle.get("files", []):
        name = item.get("file_name", "")
        if not name.lower().endswith((".tif", ".tiff")):
            continue
        url = f"{API}/bundle/{task_id}/{item['file_id']}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=180) as res:
            blob = res.read()
        dest = out_dir / os.path.basename(name)
        dest.write_bytes(blob)
        saved.append({"file": str(dest.relative_to(ROOT)), "bytes": len(blob)})
        step(f"downloaded {dest.name} ({len(blob)/1e6:.1f} MB)")
    return saved


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--submit", action="store_true")
    ap.add_argument("--task-id")
    ap.add_argument("--poll-seconds", type=int, default=30)
    ap.add_argument("--timeout-minutes", type=int, default=180)
    args = ap.parse_args()

    banner("Stage 3b · AppEEARS MOD11A1 LST")
    token = env("NASA_EARTHDATA_TOKEN")
    result = {
        "schemaVersion": "1.0",
        "generated": utc_now_iso(),
        "api": API,
        "product": PRODUCT,
        "layers": LAYERS,
        "status": "not_submitted",
        "note": "Default run verifies the token only. MOD11A1 is not required for the screening model; POWER TS is used as a documented proxy.",
        "task_id": args.task_id,
        "files": [],
    }
    if not token:
        result.update(status="no_token", note="NASA_EARTHDATA_TOKEN is missing from .env.")
        write_json(DERIVED / "appeears_status.json", result)
        warn("No Earthdata token; skipping AppEEARS.")
        return 0

    status, listing = request_json("GET", "/task", token)
    result["token_check"] = {"http_status": status, "ok": status == 200}
    if status != 200:
        result.update(status="auth_failed", note=str(listing)[:500])
        write_json(DERIVED / "appeears_status.json", result)
        warn(f"AppEEARS token check failed ({status}).")
        return 0
    step(f"Token accepted; {len(listing) if isinstance(listing, list) else 'some'} recent task(s) visible.")

    task_id = args.task_id
    if args.submit and not task_id:
        status, submitted = request_json("POST", "/task", token, task_payload())
        if status not in (200, 201) or "task_id" not in submitted:
            result.update(status="submit_failed", error=submitted)
            write_json(DERIVED / "appeears_status.json", result)
            warn(f"AppEEARS submit failed: {submitted}")
            return 1
        task_id = submitted["task_id"]
        result["task_id"] = task_id
        result["status"] = "submitted"
        step(f"Submitted task {task_id}")

    if task_id:
        deadline = time.time() + args.timeout_minutes * 60
        while True:
            status, state = request_json("GET", f"/task/{task_id}", token)
            phase = state.get("status", "unknown") if isinstance(state, dict) else "unknown"
            step(f"task {task_id}: {phase}")
            result["last_status"] = phase
            if phase == "done":
                result["status"] = "done"
                result["files"] = download_bundle(task_id, token, ROOT / "data/earth_appeears_lst")
                break
            if phase in {"error", "deleted"}:
                result.update(status="error", error=state)
                break
            if time.time() > deadline:
                result.update(status="timeout", note="Polling stopped; re-run with --task-id to resume.")
                break
            time.sleep(args.poll_seconds)

    write_json(DERIVED / "appeears_status.json", result)
    step(f"Wrote {DERIVED / 'appeears_status.json'} (status: {result['status']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
