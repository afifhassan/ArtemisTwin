#!/usr/bin/env python3
"""Independent verification of the ArtemisTwin screening payloads and wiring.

    python tests/verify_screening.py
    python tests/verify_screening.py --network   # also probe POWER/EONET once

Writes VERIFICATION_SCREENING.json beside the release documents. It does not
modify the existing VERIFICATION.json or SHA256.json.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public" / "data"
SITE = ROOT / "site"
SITE_DATA = SITE / "data"
MODULES = SITE / "assets" / "analog-fit"

CHECKS: list[dict] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    CHECKS.append({"name": name, "pass": bool(condition), "detail": detail})


def load(path: Path):
    def reject(value):
        raise ValueError(f"non-finite number {value} in {path}")

    return json.loads(path.read_text(encoding="utf-8"), parse_constant=reject)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--network", action="store_true")
    args = ap.parse_args()

    required = [
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
    for name in required:
        check(f"public/data/{name} exists", (PUBLIC / name).is_file())
        check(f"site/data/{name} exists", (SITE_DATA / name).is_file())
        if (PUBLIC / name).is_file() and (SITE_DATA / name).is_file():
            check(
                f"{name} mirror is byte-identical",
                (PUBLIC / name).read_bytes() == (SITE_DATA / name).read_bytes(),
            )

    model = load(PUBLIC / "model.json")
    targets = {t["target_id"]: t for t in load(PUBLIC / "targets.json")["planetary_targets"]}
    sites = {s["site_id"]: s for s in load(PUBLIC / "sites.json")["sites"]}
    scores = load(PUBLIC / "scores.json")
    geojson = load(PUBLIC / "earth_analog_sites.geojson")
    manifest = load(PUBLIC / "manifest.json")
    catalog_public = load(PUBLIC / "catalog.json")
    check("public/data/catalog.json present", (PUBLIC / "catalog.json").is_file())
    check(
        "catalog mirrors are byte-identical",
        (PUBLIC / "catalog.json").read_bytes() == (SITE_DATA / "catalog.json").read_bytes(),
    )
    for candidate in catalog_public.get("candidates", []):
        area = candidate.get("studyArea")
        check(f"catalog {candidate['id']}: studyArea present", bool(area))
        if area:
            check(f"catalog {candidate['id']}: CRS is EPSG:4326", area.get("crsId") == "EPSG:4326")
            check(f"catalog {candidate['id']}: studyId + label", bool(area.get("studyId")) and bool(area.get("label")))
            ring = area.get("ringWGS84") or []
            check(f"catalog {candidate['id']}: closed ring", len(ring) == 5 and ring[0] == ring[-1])
            check(f"catalog {candidate['id']}: centre", len(area.get("centreWGS84") or []) == 2)
    for site_id, site in sites.items():
        check(f"{site_id}: 49-point E–W profile", len(site.get("profile_ew_m") or []) == 49)
        check(f"{site_id}: grid cell recorded", bool(site.get("grid_cell_m")))

    check("model method version present", bool(model.get("method_version")))
    check("13 layer registry rows (12 groups; temperature split)", len(model.get("layer_registry", [])) == 13, f"{len(model.get('layer_registry', []))} registry rows")
    check("targets present", len(targets) >= 3, f"{len(targets)} targets")
    check("sites present", len(sites) == 7, f"{len(sites)} sites")
    check("every target has every purpose", all(
        set(p["purpose_id"] for p in model["purposes"]).issubset(set(scores[t].keys())) for t in targets
    ))

    max_fit_error = 0.0
    for target_id, target in targets.items():
        for purpose in model["purposes"]:
            rows = scores[target_id][purpose["purpose_id"]]
            check(
                f"{target_id}/{purpose['purpose_id']}: one row per site",
                len(rows) == len(sites),
                f"{len(rows)} rows",
            )
            for row in rows:
                site = sites[row["site_id"]]
                check(
                    f"{target_id}/{purpose['purpose_id']}/{row['site_id']}: completeness present",
                    row["data_completeness_pct"] == site["data_completeness_pct"],
                )
                check(
                    f"{target_id}/{purpose['purpose_id']}/{row['site_id']}: layer count present",
                    row["layers_present"] == site["layers_present"],
                )
                ci = row["confidence_interval"]
                check(
                    f"{target_id}/{purpose['purpose_id']}/{row['site_id']}: band ordered",
                    ci["ci_lower_p10"] <= ci["ci_upper_p90"],
                )
                check(
                    f"{target_id}/{purpose['purpose_id']}/{row['site_id']}: fit in range",
                    0 <= row["fit_score"] <= 100,
                )
                check(
                    f"{target_id}/{purpose['purpose_id']}/{row['site_id']}: pressure excluded",
                    "L6" in row["excluded_layers"],
                )
                # Recompute the weighted mean from the published layer rows.
                num = 0.0
                den = 0.0
                for entry in row["layer_breakdown"].values():
                    if entry.get("s_i") is None:
                        continue
                    weight = entry.get("effective_weight", 0)
                    if weight <= 0:
                        continue
                    num += weight * entry["s_i"]
                    den += weight
                recomputed = (num / den * 100.0) if den else None
                if recomputed is not None:
                    max_fit_error = max(max_fit_error, abs(recomputed - row["fit_score"]))
                    check(
                        f"{target_id}/{purpose['purpose_id']}/{row['site_id']}: fit recomputes",
                        abs(recomputed - row["fit_score"]) < 0.01,
                        f"{recomputed:.4f} vs {row['fit_score']}",
                    )
                else:
                    check(f"{target_id}/{purpose['purpose_id']}/{row['site_id']}: fit computable", False)

    check("maximum fit recomputation error < 0.01", max_fit_error < 0.01, f"{max_fit_error:.6f}")

    # GeoJSON geometry.
    check("GeoJSON has one feature per site", len(geojson["features"]) == len(sites))
    for feature in geojson["features"]:
        ring = feature["geometry"]["coordinates"][0]
        check(f"{feature['properties']['site_id']}: closed ring", ring[0] == ring[-1])
        check(f"{feature['properties']['site_id']}: 4 unique corners", len(ring) == 5)
        check(f"{feature['properties']['site_id']}: role declared", "screening window" in feature["properties"]["role"])

    # Manifest hashes.
    import hashlib

    for name, entry in manifest["files"].items():
        path = PUBLIC / name
        if path.is_file():
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            check(f"manifest hash {name}", digest == entry["sha256"])

    # Index wiring.
    index = (SITE / "index.html").read_text(encoding="utf-8")
    check("index references screening CSS", "/assets/analog-fit/analog-fit.css" in index)
    check("index references screening entry", "/assets/analog-fit/analog-fit.js" in index)
    for module in MODULES.glob("*.js"):
        check(f"module present {module.name}", module.stat().st_size > 0)

    # No credentials in the static build.
    env_path = ROOT / ".env"
    secrets = []
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                key, value = line.split("=", 1)
                value = value.strip().strip('"').strip("'")
                if key.strip() in {"NASA_EARTHDATA_TOKEN", "NASA_API_KEY"} and len(value) > 12:
                    secrets.append(value)
    leaked = 0
    for path in SITE.rglob("*"):
        if not path.is_file() or path.suffix.lower() in {".png", ".webp", ".avif", ".woff2", ".ico"}:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        leaked += sum(1 for secret in secrets if secret in text)
    check("no NASA credentials bundled in site/", leaked == 0, f"{leaked} matches")

    # Optional live probes.
    live = {}
    if args.network:
        import urllib.request

        for name, url in {
            "power": "https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=TS,PS&community=RE&longitude=-67.98&latitude=-23.86&format=JSON",
            "eonet": "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=1",
        }.items():
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ArtemisTwin-verify/1.0"}), timeout=30) as res:
                    live[name] = {"status": int(getattr(res, "status", 200)), "ok": True}
            except Exception as exc:
                live[name] = {"ok": False, "error": str(exc)[:200]}
            check(f"live {name} endpoint", live[name].get("ok", False))

    passed = sum(1 for c in CHECKS if c["pass"])
    payload = {
        "version": "1.0",
        "scope": "additive screening integration; does not replace the 0.8.0-rc.1 verification",
        "generated": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "checks": len(CHECKS),
        "passed": passed,
        "failed": len(CHECKS) - passed,
        "pass": passed == len(CHECKS),
        "maxFitRecomputeError": round(max_fit_error, 8),
        "liveProbes": live,
        "results": CHECKS,
    }
    (ROOT / "VERIFICATION_SCREENING.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"{passed}/{len(CHECKS)} checks passed")
    if passed != len(CHECKS):
        for item in CHECKS:
            if not item["pass"]:
                print("FAIL:", item["name"], item["detail"])
        return 1
    print(f"Wrote {ROOT / 'VERIFICATION_SCREENING.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
