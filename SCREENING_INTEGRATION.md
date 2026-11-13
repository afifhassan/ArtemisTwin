# ArtemisTwin — screening integration

**Status:** added provisional layer on top of the preserved `0.8.0-rc.1` frontend.
It does not replace the release's evidence review, its unset `Fit`, or its
verification documents.

---

## 1. What this adds

| Layer | Where it lives | What it does |
|---|---|---|
| Offline ETL | `scripts/` | Acquires public terrain/climate data, derives slope/TRI, scores 7 windows × 3 targets × 4 purposes, and exports static JSON/CSV. |
| Static payloads | `public/data/` → mirrored to `site/data/` | `layers.csv`, `sites.csv`, `targets.json`, `scores.json`, `earth_analog_sites.geojson`, `model.json`, `provenance.json`, `manifest.json`. |
| Frontend modules | `src/modules/` → built to `site/assets/analog-fit/` | Adds score cards, a condition matrix, gap analysis, live NASA badges, map overlays/markers, and an E–W terrain briefing. |
| Styles | `src/styles/analog-fit.css` | Scoped `.atf-*` rules only; reuses the project's existing tokens and fonts. |
| Verification | `tests/verify_screening.py` | 600+ independent checks over payload integrity, score recomputation, hashes, mirrors, and credential leakage. |

**The original bundle, stylesheet, catalog, comparison file, images, and release
documents are unchanged.** `site/index.html` gained exactly two tags:

```html
<script type="module" src="/assets/analog-fit/analog-fit.js"></script>
<link rel="stylesheet" href="/assets/analog-fit/analog-fit.css">
```

---

## 2. Run it

```text
python scripts/run_pipeline.py          # full ETL (probes optional sources, then exports)
python scripts/build_frontend_modules.py
python serve.py --port 8080
# open http://127.0.0.1:8080/
```

If port 8080 is already occupied on your machine, use another port
(`python serve.py --port 8099`). The app is static; Python only serves files.

Quick local loop without external probes:

```text
python scripts/run_pipeline.py --quick
python scripts/build_frontend_modules.py
```

Credentials live in `.env` (git-ignored). The Earthdata token expires
**2027-01-09**; the NASA API key is used server-side only and is **never**
bundled into `site/`.

The original release checksum manifest is preserved as
`SHA256_RELEASE_0.8.0-rc.1.json`. `SHA256.json` is regenerated for this delivery
with `python scripts/hash_release.py` so the extended `index.html` and the new
assets are covered rather than silently mismatched.

---

## 3. Data provenance (and what is missing)

| Layer | Source actually used | Status |
|---|---|---|
| L1 relief / elevation | AWS Terrain Tiles (Terrarium), z14, 12.5 m sampling | **real DEM**, composite of SRTM/3DEP/ASTER/ETOPO1 |
| L2 slope | Horn 3×3 on the same DEM | derived |
| L3 roughness | Riley et al. (1999) TRI, normalised by cell size | derived |
| L4 surface temperature | NASA POWER `TS` monthly climatology | **proxy** (skin temperature, monthly means) |
| L5 solar irradiance | NASA POWER `ALLSKY_SFC_SW_DWN` | **proxy**, converted kWh/m²/day → W/m² |
| L6 pressure | NASA POWER `PS` | measured, but **excluded** from the fit for Moon/Mars |
| L9 dust | NASA POWER `AOD_55` → `min(1, AOD/0.8)` | **proxy**, not regolith abrasion |
| L7 ice, L8 mineralogy, L10 rocks, L11 caves, L12 access | not acquired in this build | **named gaps**, never imputed as zero |

Known endpoint/credential limits, recorded rather than hidden:

- The brief's USGS planetary DEM URLs return **404** (the map service was
  reorganised). The manifest keeps the URLs and points to the current product
  pages. No lunar/Martian raster measurement is claimed.
- The brief's PDS Diviner path also returns **404**. Published Diviner context
  is recorded; no raster statistics are claimed.
- AppEEARS MOD11A1 returns **403** for this Earthdata token (AppEEARS needs an
  authorised profile/EULA). The request/poll/download code is implemented and
  opt-in; POWER `TS` is the documented proxy instead.
- `gdaldem` is absent on the build machine. Planetary slope rasters are skipped;
  Earth slope/TRI use the same equations in numpy. If GDAL is installed, the
  script produces the global `moon_slope.tif` / `mars_slope.tif` rasters.

Because five of twelve layer groups have no Earth value, **Data Completeness is
58 % (7 of 12)** for every window. That is a property of this build, not of the
sites.

---

## 4. Scoring rules

```text
s_i   = max(0, 1 − |Earth_i − target_i| / tolerance_i)
fit   = 100 × Σ(effective_weight_i × s_i) / Σ(effective_weight_i)
```

- **Weights** change with purpose (rover mobility, ice detection, habitat
  thermal, cave robotics). They are published in `model.json`.
- **Proxy layers** carry half weight (`proxy_weight_multiplier = 0.5`).
- **Pressure is excluded** for Moon/Mars targets; it is displayed but never
  enters the fit.
- **Missing ≠ zero.** Missing layers are listed, lower completeness, and are
  excluded from the weighted mean rather than scored as gaps.
- **Monte Carlo:** 4,000 draws over measurement, target-envelope and weight
  uncertainty; the displayed band is p10–p90.
- **Missing-data sensitivity:** a separate p10–p90 range shows what the score
  would be if unmeasured conditions ranged from gap to full. It is **not** a
  confidence interval.
- **Evidence status** is based on the fraction of the purpose's weight that is
  unmeasured: `Most weight measured` (≤25 % missing), `Partial weight measured`
  (25–50 %), `Thin evidence` (>50 %).

Absolute elevation is never compared across bodies. `L1_elevation` is scored on
**local relief** inside the same 2 × 2 km footprint. The target envelopes are
analyst-set screening ranges, not measurements of a chosen landing site.

---

## 5. Frontend integration points

| Existing screen | What is appended | Module |
|---|---|---|
| Target & Purpose (`#startBody`) | Catalog screening table + method disclosure + link rows to Site Detail | `screens.js` |
| Match Map (`.mb-k`) | Layer switches (7 windows, MODIS LST, MODIS AOD), “Fit all 7 windows”, map status | `screens.js` |
| Match Map inspector (`#insp`) | Compact Analog Fit card + live POWER/EONET | `screens.js` |
| Site Detail (`#detailBody`) | Score card, 13-row matrix, gaps/Earth limits, live feeds with live recompute | `comparison.js` |
| Portfolio & Gaps (`#portfolioBody`) | Coverage table, shared-gap counts, “no combined fit” note | `portfolio.js` |
| Twin Viewer (`#viewerBody`) | Measured E–W terrain profile and scale/extent facts | `viewer.js` |
| Map canvas | NASA GIBS raster overlays and 7 clickable screening markers | `map.js` |

The mounts are defensive: if the host bundle re-renders a container, a
`MutationObserver` re-attaches the panel. If the map library never loads, the
map panel says so and the rest of the page still works.

**Live APIs** (no key required, no secrets in the bundle):

- NASA POWER monthly climatology for the selected site, with a 30-minute
  `sessionStorage` cache and a fallback to POWER climatology.
- NASA EONET v3 open events, filtered by a true 300 km haversine radius.
- A live recompute uses the same published weights and target envelopes; it is
  labelled as such and never silently overwrites the cached score.

**Map deep link:** add `?fit=all` before the hash
(`/?fit=all#/map?...`) or use the “Fit all 7 windows” button. Screening markers
open the matching Site Detail route.

---

## 6. Scientific limits (must stay visible)

- No Earth site is an **exact match** or **equal** to the Moon or Mars.
- No score is an astronaut-safety, operational, landing-site or “safest site”
  recommendation.
- Gravity, vacuum, space radiation, true polar lighting and regolith behaviour
  are **not** reproduced by any Earth surface site and are **not** in the fit.
- Terrain metrics describe a 2 × 2 km sample at a 10–30 m composite DEM; they do
  not resolve wheel-scale rocks, crevasses, loose scree or permitting.
- The target envelopes and purpose weights are model choices. Different choices
  produce different numbers.

---

## 7. Verification

```text
python tests/verify_screening.py --network
```

Result: **600+ checks passed** (`VERIFICATION_SCREENING.json`), covering:

- every JSON can be parsed without NaN/Infinity;
- every score recomputes from its published layer rows (max error 0.000000);
- completeness and layer counts agree with `sites.json`;
- pressure is excluded for every Moon/Mars fit;
- GeoJSON rings are closed and match the seven sites;
- `site/data` mirrors are byte-identical and hashes match `manifest.json`;
- `index.html` references the additive assets;
- no NASA credential is present anywhere under `site/`.

Browser checks (headless Chromium, local server):

- desktop start, detail, portfolio, viewer and map render without console-blocking
  errors;
- 7 markers render, a real mouse click opens `/site/atacama`;
- MODIS LST overlay toggles MapLibre visibility;
- “Fit all 7 windows” recentres the map;
- POWER/EONET fill the live panel and the live recompute matches the cached fit;
- true 390 px emulation shows `scrollWidth = 390` (no page overflow); the matrix
  remains keyboard-focusable and horizontally scrollable.

Screenshots: `docs/screenshots/`.

---

## 8. Deliberate next steps

1. Submit AppEEARS MOD11A1 (or VIIRS) once the Earthdata profile/EULA is
   authorised; replace the `TS` proxy for L4.
2. Acquire EMIT/ASTER mineralogy, SMAP/seasonal snow, rock-abundance and OSM
   cave/access layers; completeness should rise before any interpretation.
3. Reconcile the target envelopes with the team's adopted study areas.
4. Run a neutral human usability review and an assistive-technology pass; this
   build adds panels but has not been through that review.
5. If hosting under a sub-path (e.g. GitHub Pages `/artemis-twin/`), rebuild the
   existing bundle with the matching Vite `--base` and update the two additive
   tag paths.
