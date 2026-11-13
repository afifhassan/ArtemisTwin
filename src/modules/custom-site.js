/* ArtemisTwin — on-demand custom 2 × 2 km site sampling.
   Terrain comes from public AWS Terrarium z14 tiles decoded through an
   off-screen canvas; climate comes from NASA POWER climatology. Everything is
   client-side and no server dependency is added. */

import { num } from "./format.js";

const TILE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const POWER = "https://power.larc.nasa.gov/api/temporal/climatology/point";
const STORAGE_KEY = "atf:custom-site:v1";
const TILE_CACHE = new Map();
let activeCustom = undefined;
export const customEvents = new EventTarget();

export function setActiveCustom(payload) {
  activeCustom = payload || null;
  if (payload) saveCustom(payload);
  else clearCustom();
  customEvents.dispatchEvent(new CustomEvent("change", { detail: activeCustom }));
}

export function getActiveCustom() {
  if (activeCustom === undefined) activeCustom = loadCustom();
  return activeCustom;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > -900 ? n : null;
}

function mean(values) {
  const ok = values.filter((v) => Number.isFinite(v));
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
}

function percentile(values, p) {
  const ok = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!ok.length) return null;
  const idx = Math.min(ok.length - 1, Math.max(0, Math.ceil((p / 100) * ok.length) - 1));
  return ok[idx];
}

function lonLatToPixel(lat, lon, z) {
  const n = 2 ** z * 256;
  const x = ((lon + 180) / 360) * n;
  const latR = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  const y = ((1 - Math.asinh(Math.tan(latR)) / Math.PI) / 2) * n;
  return { x, y };
}

function bboxAround(lat, lon, halfKm = 1) {
  const dlat = halfKm / 110.574;
  const dlon = halfKm / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return { south: lat - dlat, north: lat + dlat, west: lon - dlon, east: lon + dlon };
}

async function tileHeights(z, x, y, signal) {
  const key = `${z}/${x}/${y}`;
  if (TILE_CACHE.has(key)) return TILE_CACHE.get(key);
  const promise = (async () => {
    const url = TILE.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    const res = await fetch(url, { signal, mode: "cors", cache: "force-cache" });
    if (!res.ok) throw new Error(`Terrain tile ${z}/${x}/${y}: HTTP ${res.status}`);
    const blob = await res.blob();
    let source;
    if (typeof createImageBitmap === "function") {
      source = await createImageBitmap(blob);
    } else {
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Terrain image decode failed"));
        img.src = URL.createObjectURL(blob);
      });
    }
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const data = ctx.getImageData(0, 0, 256, 256).data;
    const heights = new Float32Array(256 * 256);
    for (let i = 0; i < heights.length; i += 1) {
      const o = i * 4;
      heights[i] = data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768;
    }
    if (source.close) source.close();
    return heights;
  })();
  TILE_CACHE.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    TILE_CACHE.delete(key);
    throw error;
  }
}

function makeSampler(tiles) {
  return (gx, gy) => {
    const tx = Math.floor(gx / 256);
    const ty = Math.floor(gy / 256);
    const tile = tiles.get(`${tx}/${ty}`);
    if (!tile) return null;
    const lx = gx - tx * 256;
    const ly = gy - ty * 256;
    return tile[Math.floor(ly) * 256 + Math.floor(lx)] ?? null;
  };
}

function bilinear(sample, gx, gy) {
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const p00 = sample(x0, y0);
  const p10 = sample(x0 + 1, y0);
  const p01 = sample(x0, y0 + 1);
  const p11 = sample(x0 + 1, y0 + 1);
  if ([p00, p10, p01, p11].some((v) => v === null)) {
    return p00 ?? p10 ?? p01 ?? p11 ?? null;
  }
  return (
    p00 * (1 - fx) * (1 - fy) +
    p10 * fx * (1 - fy) +
    p01 * (1 - fx) * fy +
    p11 * fx * fy
  );
}

export async function sampleTerrain(lat, lon, { halfKm = 1, grid = 161, signal } = {}) {
  const bbox = bboxAround(lat, lon, halfKm);
  const z = 14;
  const nw = lonLatToPixel(bbox.north, bbox.west, z);
  const se = lonLatToPixel(bbox.south, bbox.east, z);
  const tx0 = Math.floor(nw.x / 256);
  const tx1 = Math.floor(se.x / 256);
  const ty0 = Math.floor(nw.y / 256);
  const ty1 = Math.floor(se.y / 256);
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 64) throw new Error("Window spans too many tiles");

  const tiles = new Map();
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty += 1) {
    for (let tx = tx0; tx <= tx1; tx += 1) {
      jobs.push(
        tileHeights(z, tx, ty, signal).then((heights) => {
          tiles.set(`${tx}/${ty}`, heights);
        })
      );
    }
  }
  await Promise.all(jobs);
  const sample = makeSampler(tiles);

  const values = new Float64Array(grid * grid);
  const xs = [];
  const ys = [];
  for (let i = 0; i < grid; i += 1) {
    xs.push(nw.x + ((se.x - nw.x) * i) / (grid - 1));
    ys.push(nw.y + ((se.y - nw.y) * i) / (grid - 1));
  }
  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r < grid; r += 1) {
    for (let c = 0; c < grid; c += 1) {
      const v = bilinear(sample, xs[c], ys[r]);
      if (v === null) throw new Error("No terrain samples in this window");
      values[r * grid + c] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  const cell = (2 * halfKm * 1000) / (grid - 1);
  const slopes = [];
  const tris = [];
  const at = (r, c) => values[Math.max(0, Math.min(grid - 1, r)) * grid + Math.max(0, Math.min(grid - 1, c))];
  for (let r = 1; r < grid - 1; r += 1) {
    for (let c = 1; c < grid - 1; c += 1) {
      const z1 = at(r - 1, c - 1);
      const z2 = at(r - 1, c);
      const z3 = at(r - 1, c + 1);
      const z4 = at(r, c - 1);
      const z5 = at(r, c);
      const z6 = at(r, c + 1);
      const z7 = at(r + 1, c - 1);
      const z8 = at(r + 1, c);
      const z9 = at(r + 1, c + 1);
      const dzdx = ((z3 + 2 * z6 + z9) - (z1 + 2 * z4 + z7)) / (8 * cell);
      const dzdy = ((z7 + 2 * z8 + z9) - (z1 + 2 * z2 + z3)) / (8 * cell);
      slopes.push((Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI);
      const sq =
        (z1 - z5) ** 2 + (z2 - z5) ** 2 + (z3 - z5) ** 2 + (z4 - z5) ** 2 +
        (z6 - z5) ** 2 + (z7 - z5) ** 2 + (z8 - z5) ** 2 + (z9 - z5) ** 2;
      tris.push(Math.sqrt(sq) / cell);
    }
  }

  const profile = [];
  const mid = Math.floor(grid / 2);
  for (let i = 0; i < 49; i += 1) {
    const c = Math.round((i / 48) * (grid - 1));
    profile.push(Number(values[mid * grid + c].toFixed(1)));
  }
  const total = values.length;
  const elevationMean = values.reduce((a, b) => a + b, 0) / total;

  return {
    L1_elevation_mean_m: Number(elevationMean.toFixed(1)),
    L1_elevation_min_m: Number(min.toFixed(1)),
    L1_elevation_max_m: Number(max.toFixed(1)),
    L1_relief_m: Number((max - min).toFixed(1)),
    L2_slope_mean: Number((mean(slopes) ?? 0).toFixed(2)),
    L2_slope_p95: Number((percentile(slopes, 95) ?? 0).toFixed(2)),
    L3_roughness_mean: Number((mean(tris) ?? 0).toFixed(3)),
    L3_roughness_p95: Number((percentile(tris, 95) ?? 0).toFixed(3)),
    profile_ew_m: profile,
    profile_step_m: Number(((2 * halfKm * 1000) / 48).toFixed(1)),
    grid_cell_m: Number(cell.toFixed(1)),
    terrain_bbox: {
      west: Number(bbox.west.toFixed(6)),
      south: Number(bbox.south.toFixed(6)),
      east: Number(bbox.east.toFixed(6)),
      north: Number(bbox.north.toFixed(6)),
    },
    terrain_source: "AWS Terrain Tiles (Terrarium) z14, sampled in-browser",
    terrain_status: "ok",
  };
}

export async function fetchClimate(lat, lon, { signal } = {}) {
  const params = new URLSearchParams({
    parameters: "TS,PS,ALLSKY_SFC_SW_DWN,AOD_55,WS2M,PRECTOTCORR,RH2M",
    community: "RE",
    longitude: lon.toFixed(6),
    latitude: lat.toFixed(6),
    format: "JSON",
  });
  const res = await fetch(`${POWER}?${params.toString()}`, { signal, mode: "cors", cache: "no-store" });
  if (!res.ok) throw new Error(`NASA POWER: HTTP ${res.status}`);
  const payload = await res.json();
  const p = payload?.properties?.parameter || {};
  const series = (key) => MONTHS.map((m) => finite(p?.[key]?.[m])).filter((v) => v !== null);
  const ts = series("TS");
  const solar = finite(p?.ALLSKY_SFC_SW_DWN?.ANN);
  const pressure = finite(p?.PS?.ANN);
  const aod = finite(p?.AOD_55?.ANN);
  const wind = finite(p?.WS2M?.ANN);
  const rain = finite(p?.PRECTOTCORR?.ANN);
  const rh = finite(p?.RH2M?.ANN);
  const tmean = finite(p?.TS?.ANN);
  return {
    L4_temp_max: ts.length ? Number(Math.max(...ts).toFixed(2)) : null,
    L4_temp_min: ts.length ? Number(Math.min(...ts).toFixed(2)) : null,
    L4_temp_mean: tmean === null ? null : Number(tmean.toFixed(2)),
    L5_solar_mean: solar === null ? null : Number(((solar * 1000) / 24).toFixed(2)),
    L6_pressure_mean: pressure === null ? null : Number(pressure.toFixed(2)),
    L9_aod_550: aod === null ? null : Number(aod.toFixed(3)),
    L9_dust_idx: aod === null ? null : Number(Math.max(0, Math.min(1, aod / 0.8)).toFixed(3)),
    wind_ms: wind === null ? null : Number(wind.toFixed(2)),
    rain_mm_year: rain === null ? null : Number((rain * 365.25).toFixed(1)),
    rh_pct: rh === null ? null : Number(rh.toFixed(1)),
    climate_source: "NASA POWER climatology (MERRA-2), community RE",
  };
}

function groupPresence(site) {
  const keys = {
    L1_elevation: ["L1_relief_m"],
    L2_slope: ["L2_slope_mean"],
    L3_roughness: ["L3_roughness_mean"],
    L4_temperature: ["L4_temp_max", "L4_temp_min"],
    L5_solar_illumination: ["L5_solar_mean"],
    L6_surface_pressure: ["L6_pressure_mean"],
    L7_ice_volatiles: ["L7_ice_moisture_mean"],
    L8_mineralogy: ["L8_mineral_idx"],
    L9_dust_hazard: ["L9_dust_idx"],
    L10_rock_abundance: ["L10_rock_abundance"],
    L11_cave_proximity: ["L11_cave_dist_km"],
    L12_access: ["L12_access_road_km"],
  };
  const present = Object.entries(keys)
    .filter(([, fields]) => fields.every((f) => site[f] !== null && site[f] !== undefined))
    .map(([group]) => group);
  return { present, total: Object.keys(keys).length };
}

export function createCustomSite({ lat, lon, terrain, climate }) {
  const id = `custom_${lat.toFixed(4)}_${lon.toFixed(4)}`.replace(/-/g, "m");
  const ns = `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? "N" : "S"}`;
  const ew = `${Math.abs(lon).toFixed(3)}°${lon >= 0 ? "E" : "W"}`;
  const site = {
    site_id: id,
    site_name: `Custom site ${ns}, ${ew}`,
    country: "User-selected",
    region: "Earth map",
    catalog_id: null,
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    half_km: 1,
    window_km: 2,
    window_label: `User-selected 2 × 2 km window at ${ns}, ${ew}`,
    note: "User-selected point, sampled on demand in the browser. Not a surveyed, permitted or validated field site.",
    custom: true,
    ...terrain,
    ...climate,
    L7_ice_moisture_mean: null,
    L8_mineral_idx: null,
    L10_rock_abundance: null,
    L11_cave_dist_km: null,
    L12_access_road_km: null,
  };
  const groups = groupPresence(site);
  site.present_layers = groups.present;
  site.missing_layers = ["L7_ice_volatiles", "L8_mineralogy", "L10_rock_abundance", "L11_cave_proximity", "L12_access"];
  site.layers_present = groups.present.length;
  site.layers_total = groups.total;
  site.data_completeness_pct = Number(((groups.present.length / groups.total) * 100).toFixed(1));
  return site;
}

function randn() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function classify(s) {
  if (s >= 0.8) return "Strong overlap";
  if (s >= 0.4) return "Partial overlap";
  return "Gap";
}

export function buildCustomScore(store, site, target, purpose, { draws = 800 } = {}) {
  const weights = purpose?.weights || {};
  const cols = store.model.site_columns || {};
  const breakdown = {};
  const available = [];
  const missing = [];
  const excluded = [];
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const spec = target?.layers?.[key];
    if (!spec) continue;
    const comparability = spec.comparability || "direct";
    const col = cols[key];
    const raw = col ? site[col] : null;
    const value = raw === null || raw === undefined ? null : Number(raw);
    const effective = comparability === "excluded" || comparability === "context"
      ? 0
      : Number(weight) * (comparability === "proxy" ? 0.5 : 1);
    if (comparability !== "excluded" && comparability !== "context") totalWeight += effective;

    const entry = {
      earth_val: Number.isFinite(value) ? value : null,
      weight: Number(weight),
      effective_weight: Number(effective.toFixed(4)),
      comparability,
      s_i: null,
      status: "Missing",
    };
    if (comparability === "excluded") {
      entry.status = "Excluded";
      excluded.push(key);
    } else if (!Number.isFinite(value)) {
      entry.status = "Missing";
      missing.push({ key, effective_weight: effective });
    } else if (comparability === "context") {
      entry.status = "Context";
    } else {
      const tol = Number(spec.tolerance);
      const s = tol > 0 ? Math.max(0, 1 - Math.min(1, Math.abs(value - Number(spec.target_val)) / tol)) : (value === Number(spec.target_val) ? 1 : 0);
      entry.s_i = Number(s.toFixed(4));
      entry.status = classify(s);
      available.push({ key, value, s, effective, tolerance: tol, target: Number(spec.target_val) });
    }
    breakdown[key] = entry;
  }

  const num = available.reduce((acc, l) => acc + l.effective * l.s, 0);
  const den = available.reduce((acc, l) => acc + l.effective, 0);
  const fit = den > 0 ? (num / den) * 100 : null;

  let p10 = null;
  let p50 = null;
  let p90 = null;
  if (available.length) {
    const sims = [];
    for (let d = 0; d < draws; d += 1) {
      let sNum = 0;
      let sDen = 0;
      for (const l of available) {
        const sigmaE = Math.max(Math.abs(l.value) * 0.05, l.tolerance * 0.02);
        const earth = l.value + randn() * sigmaE;
        const targetV = l.target + randn() * l.tolerance * 0.1;
        const w = Math.max(0.01, l.effective * (1 + randn() * 0.1));
        const s = Math.max(0, 1 - Math.min(1, Math.abs(earth - targetV) / l.tolerance));
        sNum += w * s;
        sDen += w;
      }
      sims.push((sNum / sDen) * 100);
    }
    sims.sort((a, b) => a - b);
    const pick = (q) => sims[Math.min(sims.length - 1, Math.max(0, Math.floor(q * sims.length)))];
    p10 = pick(0.1);
    p50 = pick(0.5);
    p90 = pick(0.9);
  }

  const availableWeight = available.reduce((a, l) => a + l.effective, 0);
  const missingFraction = totalWeight > 0 ? (totalWeight - availableWeight) / totalWeight : 1;
  const evidenceStatus = missingFraction > 0.5 ? "thin" : missingFraction > 0.25 ? "partial" : "ok";
  const evidenceNotes = {
    ok: "Most of this purpose's model weight has an Earth value.",
    partial: `Partial evidence: ${Math.round(missingFraction * 100)}% of this purpose's model weight is unmeasured.`,
    thin: `Thin evidence: ${Math.round(missingFraction * 100)}% of this purpose's model weight is unmeasured.`,
  };

  return {
    site_id: site.site_id,
    site_name: site.site_name,
    country: site.country,
    lat: site.lat,
    lon: site.lon,
    fit_score: fit === null ? null : Number(fit.toFixed(2)),
    fit_score_display: fit === null ? "Not computable" : `${Math.round(fit)}`,
    confidence_interval: {
      mean: fit === null ? null : Number(mean([p10, p50, p90]).toFixed(2)),
      median: p50 === null ? null : Number(p50.toFixed(2)),
      ci_lower_p10: p10 === null ? null : Number(p10.toFixed(2)),
      ci_upper_p90: p90 === null ? null : Number(p90.toFixed(2)),
      std_dev: null,
      display_range: p50 === null ? "No band" : `${p50.toFixed(0)}, likely ${p10.toFixed(0)}–${p90.toFixed(0)}`,
      draws,
      probability_above_60: null,
    },
    data_completeness_pct: site.data_completeness_pct,
    scored_weight_coverage_pct: totalWeight ? Number(((availableWeight / totalWeight) * 100).toFixed(1)) : 0,
    missing_weight_fraction: Number(missingFraction.toFixed(3)),
    evidence_status: evidenceStatus,
    evidence_note: evidenceNotes[evidenceStatus],
    dominant_missing: [],
    layers_present: site.layers_present,
    layers_total: site.layers_total,
    available_layers: available.map((l) => l.key),
    missing_layers: missing.map((m) => m.key),
    excluded_layers: excluded,
    layer_breakdown: breakdown,
    sensitivity_missing: { p10: null, p50: null, p90: null },
    custom: true,
  };
}

export function saveCustom(payload) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...payload, savedAt: new Date().toISOString() }));
  } catch {
    /* storage may be unavailable */
  }
}

export function loadCustom() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearCustom() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

export async function runCustomSample(store, lat, lon, { signal, onStatus } = {}) {
  onStatus?.("Sampling 2 × 2 km terrain — AWS Terrarium z14");
  const [terrain, climate] = await Promise.all([
    sampleTerrain(lat, lon, { signal }),
    fetchClimate(lat, lon, { signal }).catch((error) => {
      console.warn("[ArtemisTwin] POWER climatology unavailable for custom site:", error);
      return { climate_error: String(error.message || error) };
    }),
  ]);
  const site = createCustomSite({ lat, lon, terrain, climate });
  const payload = { site, sampledAt: new Date().toISOString(), climateError: climate.climate_error || null };
  saveCustom(payload);
  return payload;
}

export function customSummaryLine(site) {
  return `${num(site.L1_relief_m, 1)} m relief · ${num(site.L2_slope_mean, 2)}° median slope · ${num(site.L3_roughness_mean, 2)} TRI`;
}
