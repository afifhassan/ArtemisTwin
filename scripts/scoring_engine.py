#!/usr/bin/env python3
"""Stage 5 — weighted analog fit + Monte Carlo uncertainty + completeness.

The score is a *screening similarity*, 0–100, between measured Earth values and
a declared target envelope. It is not a probability of mission success and not a
match verdict.

Why this differs from a naive weighted average
----------------------------------------------
* ``excluded`` layers (pressure for Moon/Mars) are reported but never scored.
* ``proxy`` layers receive half weight.
* Missing layers are not imputed as zero. They stay missing, reduce Data
  Completeness, and are listed by name.
* The Monte Carlo band covers measurement, envelope and weight uncertainty.
  A second, clearly-labelled sensitivity range shows what the score would be if
  the missing layers ranged from gap to full — it is *not* a confidence interval.

Usage
-----
    python scripts/scoring_engine.py
    python scripts/scoring_engine.py --draws 8000
"""
from __future__ import annotations

import argparse

import numpy as np

from common import DERIVED, PUBLIC_DATA, banner, read_json, step, utc_now_iso, warn, write_json
from config import LAYER_BY_KEY, MODEL, PURPOSES, SITE_COLUMNS, TARGETS

FULL, PARTIAL, GAP, MISSING, EXCLUDED = "Strong overlap", "Partial overlap", "Gap", "Missing", "Excluded"


def partial_match(earth_val: float, target_val: float, tolerance: float) -> float:
    if tolerance is None or tolerance <= 0:
        return 1.0 if earth_val == target_val else 0.0
    return float(max(0.0, 1.0 - min(1.0, abs(earth_val - target_val) / tolerance)))


def classify(score: float) -> str:
    if score >= 0.8:
        return FULL
    if score >= 0.4:
        return PARTIAL
    return GAP


def layer_label(key: str) -> str:
    return LAYER_BY_KEY[key]["layer_name"]


def effective_weight(key: str, weight: float, comparability: str) -> float:
    if comparability == "excluded" or comparability == "context":
        return 0.0
    mult = MODEL["proxy_weight_multiplier"] if comparability == "proxy" else 1.0
    return float(weight) * mult


def monte_carlo(
    earth_vals: np.ndarray,
    target_vals: np.ndarray,
    tolerances: np.ndarray,
    weights: np.ndarray,
    draws: int,
    seed: int,
) -> dict:
    rng = np.random.default_rng(seed)
    n = earth_vals.size
    if n == 0:
        return {
            "mean": None,
            "median": None,
            "ci_lower_p10": None,
            "ci_upper_p90": None,
            "std_dev": None,
            "display_range": "Not computable: no comparable layers",
            "draws": draws,
            "probability_above_60": None,
        }

    # Measurement uncertainty: 5 % of the value, floored against the layer's own
    # tolerance so small-index layers (TRI, AOD) are not swamped by an absolute
    # floor meant for temperatures in Celsius.
    sigma_earth = np.maximum(np.abs(earth_vals) * MODEL["earth_noise_fraction"], tolerances * 0.02)
    sigma_target = tolerances * MODEL["target_noise_fraction"]

    sim_earth = earth_vals[None, :] + rng.normal(0.0, 1.0, (draws, n)) * sigma_earth[None, :]
    sim_target = target_vals[None, :] + rng.normal(0.0, 1.0, (draws, n)) * sigma_target[None, :]
    weight_noise = rng.normal(1.0, MODEL["weight_noise_fraction"], (draws, n))
    sim_weights = np.maximum(0.01, weights[None, :] * weight_noise)

    diffs = np.abs(sim_earth - sim_target)
    scores = 1.0 - np.minimum(1.0, diffs / tolerances[None, :])
    fit = (scores * sim_weights).sum(axis=1) / sim_weights.sum(axis=1) * 100.0

    p10, p50, p90 = np.percentile(fit, [10, 50, 90])
    return {
        "mean": round(float(fit.mean()), 2),
        "median": round(float(p50), 2),
        "ci_lower_p10": round(float(p10), 2),
        "ci_upper_p90": round(float(p90), 2),
        "std_dev": round(float(fit.std()), 2),
        "display_range": f"{p50:.0f}, likely {p10:.0f}–{p90:.0f}",
        "draws": draws,
        "probability_above_60": round(float((fit >= 60).mean()), 3),
    }


def missing_sensitivity(
    available: list[dict], missing: list[dict], draws: int, seed: int
) -> dict:
    """Score range if unmeasured layers ranged uniformly from 0 (gap) to 1 (full)."""
    if not missing:
        return {
            "p10": None,
            "p50": None,
            "p90": None,
        }
    rng = np.random.default_rng(seed + 1)
    fixed_num = sum(l["s_i"] * l["effective_weight"] for l in available)
    fixed_den = sum(l["effective_weight"] for l in available)
    miss_w = np.array([l["effective_weight"] for l in missing], dtype=float)
    u = rng.random((draws, miss_w.size))
    totals = fixed_num + (u * miss_w[None, :]).sum(axis=1)
    dens = fixed_den + miss_w.sum()
    fit = totals / dens * 100.0
    p10, p50, p90 = np.percentile(fit, [10, 50, 90])
    return {
        "p10": round(float(p10), 1),
        "p50": round(float(p50), 1),
        "p90": round(float(p90), 1),
    }


def score_pair(site: dict, target: dict, purpose: dict, draws: int, seed: int) -> dict:
    weights = purpose["weights"]
    breakdown: dict[str, dict] = {}
    available_layers: list[dict] = []
    missing_layers: list[dict] = []
    excluded_layers: list[str] = []
    present_count = 0

    total_included_weight = 0.0

    for key, base_weight in weights.items():
        if key not in target["layers"]:
            continue
        tgt = target["layers"][key]
        comparability = tgt["comparability"]
        col = SITE_COLUMNS[key]
        earth_val = site.get(col)
        ew = effective_weight(key, base_weight, comparability)
        if comparability != "excluded" and comparability != "context":
            total_included_weight += ew
        if earth_val is not None:
            present_count += 1

        entry = {
            "earth_val": earth_val,
            "weight": float(base_weight),
            "effective_weight": round(ew, 4),
            "comparability": comparability,
            "s_i": None,
            "status": MISSING,
        }

        if comparability == "excluded":
            entry["status"] = EXCLUDED
            excluded_layers.append(key)
        elif earth_val is None:
            entry["status"] = MISSING
            missing_layers.append(
                {
                    **entry,
                    "layer_id": LAYER_BY_KEY[key]["layer_id"],
                    "effective_weight": ew,
                    "s_i": 0.0,
                }
            )
        elif comparability == "context":
            entry["status"] = "Context"
        else:
            s_i = partial_match(float(earth_val), float(tgt["target_val"]), float(tgt["tolerance"]))
            entry["s_i"] = round(s_i, 4)
            entry["status"] = classify(s_i)
            available_layers.append(
                {
                    **entry,
                    "layer_id": LAYER_BY_KEY[key]["layer_id"],
                    "s_i": s_i,
                    "effective_weight": ew,
                    "target_val": float(tgt["target_val"]),
                    "tolerance": float(tgt["tolerance"]),
                }
            )
        breakdown[key] = entry

    num = sum(l["s_i"] * l["effective_weight"] for l in available_layers)
    den = sum(l["effective_weight"] for l in available_layers)
    fit = round(100.0 * num / den, 2) if den > 0 else None

    ae = np.array([l["earth_val"] for l in available_layers], dtype=float)
    at = np.array([l["target_val"] for l in available_layers], dtype=float)
    tol = np.array([l["tolerance"] for l in available_layers], dtype=float)
    wg = np.array([l["effective_weight"] for l in available_layers], dtype=float)
    ci = monte_carlo(ae, at, tol, wg, draws, seed)

    available_weight = sum(l["effective_weight"] for l in available_layers)
    scored_weight_coverage = round(100.0 * available_weight / total_included_weight, 1) if total_included_weight else 0.0
    missing_weight = sum(l["effective_weight"] for l in missing_layers)
    missing_weight_fraction = (missing_weight / total_included_weight) if total_included_weight else 1.0
    if missing_weight_fraction > 0.5:
        evidence_status = "thin"
        evidence_note = (
            f"Thin evidence: {missing_weight_fraction*100:.0f}% of this purpose's model weight has no Earth value. "
            "The fit is driven by the conditions that happen to be measured and must not be read as a site recommendation."
        )
    elif missing_weight_fraction > 0.25:
        evidence_status = "partial"
        evidence_note = (
            f"Partial evidence: {missing_weight_fraction*100:.0f}% of this purpose's model weight is unmeasured. "
            "Treat the fit as provisional."
        )
    else:
        evidence_status = "ok"
        evidence_note = "Most of this purpose's model weight has an Earth value."
    dominant_missing = [
        {"layer_id": LAYER_BY_KEY[layer_key]["layer_id"], "label": layer_label(layer_key), "weight": round(l["effective_weight"], 2)}
        for layer_key, l in ((k, v) for k, v in breakdown.items() if v["status"] == MISSING)
        if l["effective_weight"] >= 1.5
    ]

    return {
        "site_id": site["site_id"],
        "site_name": site["site_name"],
        "country": site.get("country"),
        "lat": site.get("lat"),
        "lon": site.get("lon"),
        "catalog_id": site.get("catalog_id"),
        "fit_score": fit,
        "fit_score_display": f"{fit:.0f}" if fit is not None else "Not computable",
        "confidence_interval": ci,
        "data_completeness_pct": site.get("data_completeness_pct"),
        "scored_weight_coverage_pct": scored_weight_coverage,
        "missing_weight_fraction": round(missing_weight_fraction, 3),
        "evidence_status": evidence_status,
        "evidence_note": evidence_note,
        "dominant_missing": dominant_missing,
        "layers_present": site.get("layers_present", present_count),
        "layers_total": site.get("layers_total", 12),
        "available_layers": [l["layer_id"] for l in available_layers],
        "missing_layers": [l["layer_id"] for l in missing_layers],
        "excluded_layers": [LAYER_BY_KEY[k]["layer_id"] for k in excluded_layers],
        "layer_breakdown": breakdown,
        "sensitivity_missing": missing_sensitivity(available_layers, missing_layers, draws, seed),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--draws", type=int, default=MODEL["monte_carlo_draws"])
    args = ap.parse_args()

    banner("Stage 5 · analog fit & Monte Carlo")
    records = (read_json(DERIVED / "site_records.json", {}) or {}).get("sites", [])
    if not records:
        warn("No site records. Run scripts/zonal_stats_extractor.py first.")
        return 2

    sites = {r["site_id"]: r for r in records}
    out: dict[str, dict] = {}
    seed_base = MODEL["monte_carlo_seed"]

    for ti, target in enumerate(TARGETS):
        out[target["target_id"]] = {}
        for pi, purpose in enumerate(PURPOSES):
            rows = []
            for si, site in enumerate(records):
                seed = seed_base + ti * 1000 + pi * 100 + si
                rows.append(score_pair(site, target, purpose, args.draws, seed))
            rows.sort(key=lambda r: (-(r["fit_score"] if r["fit_score"] is not None else -1), r["site_name"]))
            for rank, row in enumerate(rows, start=1):
                row["rank"] = rank
            out[target["target_id"]][purpose["purpose_id"]] = rows
            best = rows[0]
            step(
                f"{target['target_id']:24s} / {purpose['purpose_id']:20s} "
                f"best {best['site_name'][:24]:24s} {best['fit_score_display']:>3s} "
                f"(likely {best['confidence_interval']['ci_lower_p10']:.0f}–{best['confidence_interval']['ci_upper_p90']:.0f}) "
                f"completeness {best['data_completeness_pct']:.0f}%"
            )

    payload = {
        "_meta": {
            "schemaVersion": "1.0",
            "methodVersion": MODEL["method_version"],
            "generated": utc_now_iso(),
            "draws": args.draws,
            "seed": seed_base,
            "scoreLabel": MODEL["score_label"],
            "warning": "Analog Fit is a model-dependent screening similarity, not a match, ranking of real mission options, or safety rating.",
            "missingDataRule": "Missing layers are never imputed as zero; they lower Data Completeness and are listed by id.",
            "exclusions": "Pressure is reported but excluded from Moon/Mars fits.",
            "confidenceNote": "The band covers measurement, target-envelope and weight uncertainty only. Missing layers are not included.",
            "sensitivityNote": "The missing-data range assumes each unmeasured condition was equally likely to be a gap or a strong overlap. It is a sensitivity check, not a confidence interval.",
        },
        **out,
    }
    write_json(PUBLIC_DATA / "scores.json", payload)
    step(f"Wrote {PUBLIC_DATA / 'scores.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
