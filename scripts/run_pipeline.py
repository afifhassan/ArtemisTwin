#!/usr/bin/env python3
"""Run the complete offline ETL pipeline in order.

    python scripts/run_pipeline.py            # full: probe DEMs, terrain, climate, scoring, export
    python scripts/run_pipeline.py --quick    # skip DEM/AppEEARS/Diviner probes

The pipeline is resumable: every network result is cached under ``data/cache`` and
every stage leaves its intermediate payload in ``data/derived``.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

from common import DERIVED, ROOT, banner, step, utc_now_iso, warn, write_json

STAGES = [
    ("download", "scripts/download_dems.py", []),
    ("terrain", "scripts/derive_slope_roughness.py", []),
    ("climate", "scripts/nasa_power_climate.py", []),
    ("appeears", "scripts/appeears_lst_download.py", []),
    ("diviner", "scripts/diviner_lunar_temp.py", []),
    ("zonal", "scripts/zonal_stats_extractor.py", []),
    ("scoring", "scripts/scoring_engine.py", []),
    ("export", "scripts/export_data.py", []),
]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--quick", action="store_true", help="skip external DEM/AppEEARS/Diviner probes")
    ap.add_argument("--draws", type=int, default=None, help="Monte Carlo draws for scoring")
    ap.add_argument("--fail-fast", action="store_true")
    args = ap.parse_args()

    skip = {"appeears", "diviner", "download"} if args.quick else set()
    env = {**os.environ, "PYTHONPATH": str(ROOT / "scripts") + os.pathsep + os.environ.get("PYTHONPATH", "")}
    results = []
    started_all = time.time()

    for name, script, extra in STAGES:
        if name in skip:
            step(f"{name}: skipped (--quick)")
            results.append({"stage": name, "status": "skipped", "seconds": 0})
            continue
        cmd = [sys.executable, script, *extra]
        if name == "scoring" and args.draws:
            cmd += ["--draws", str(args.draws)]
        banner(f"{name} · {' '.join(cmd)}")
        t0 = time.time()
        proc = subprocess.run(cmd, cwd=ROOT, env=env)
        seconds = round(time.time() - t0, 1)
        status = "ok" if proc.returncode == 0 else f"exit_{proc.returncode}"
        results.append({"stage": name, "status": status, "seconds": seconds, "command": " ".join(cmd)})
        step(f"{name}: {status} in {seconds}s")
        if proc.returncode != 0:
            warn(f"{name} failed with exit code {proc.returncode}")
            if args.fail_fast:
                break

    payload = {
        "schemaVersion": "1.0",
        "generated": utc_now_iso(),
        "seconds": round(time.time() - started_all, 1),
        "quick": args.quick,
        "stages": results,
        "ok": all(r["status"] in {"ok", "skipped"} for r in results),
    }
    write_json(DERIVED / "pipeline_run.json", payload)
    banner("Pipeline summary")
    for row in results:
        step(f"{row['stage']:10s} {row['status']:10s} {row['seconds']:7.1f}s")
    print(f"\nWrote {DERIVED / 'pipeline_run.json'}")
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
