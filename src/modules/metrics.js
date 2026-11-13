/* ArtemisTwin — target-driven condition metrics.
   Single source of truth for the 12 condition groups across the inspector,
   detail tables, exports and custom-site results. */

import { STATUS, num } from "./format.js";

export const CONDITIONS = [
  { id: "elevation_topography", label: "Elevation & topography", keys: ["L1_elevation"] },
  { id: "slope", label: "Slope", keys: ["L2_slope"] },
  { id: "roughness", label: "Roughness", keys: ["L3_roughness"] },
  { id: "temperature_extremes", label: "Temperature extremes", keys: ["L4_temperature_max", "L4_temperature_min"] },
  { id: "illumination_low_sun", label: "Illumination & low Sun", keys: ["L5_solar_illumination"] },
  { id: "pressure", label: "Atmospheric pressure", keys: ["L6_surface_pressure"] },
  { id: "ice_snow_moisture", label: "Ice, snow & moisture", keys: ["L7_ice_volatiles"] },
  { id: "geology_minerals", label: "Geology & minerals", keys: ["L8_mineralogy"] },
  { id: "dust_wind", label: "Dust & wind", keys: ["L9_dust_hazard"] },
  { id: "craters_rocks", label: "Craters & rocks", keys: ["L10_rock_abundance"] },
  { id: "caves_lava_tubes", label: "Caves & lava tubes", keys: ["L11_cave_proximity"] },
  { id: "access_hazards", label: "Access & hazards", keys: ["L12_access"] },
];

const BADGE = {
  "Strong overlap": "ok",
  "Partial overlap": "partial",
  Gap: "gap",
  Missing: "na",
  Excluded: "ex",
  Context: "ex",
};

export function badgeFor(status) {
  return BADGE[status] || "na";
}

function entryFor(score, key) {
  return score?.layer_breakdown?.[key] || null;
}

function specFor(target, key) {
  return target?.layers?.[key] || null;
}

function statusFromScore(score, keys) {
  const entries = keys.map((key) => entryFor(score, key)).filter(Boolean);
  if (!entries.length) return "Missing";
  if (entries.some((entry) => entry.status === "Excluded")) return "Excluded";
  if (entries.some((entry) => entry.status === "Missing" || entry.earth_val === null || entry.earth_val === undefined)) {
    return "Missing";
  }
  const values = entries.map((entry) => Number(entry.s_i)).filter(Number.isFinite);
  if (!values.length) return "Missing";
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  if (avg >= 0.8) return "Strong overlap";
  if (avg >= 0.4) return "Partial overlap";
  return "Gap";
}

function earthValue(site, key, score) {
  const entry = entryFor(score, key);
  const v = entry?.earth_val ?? null;
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  return Number(v);
}

export function conditionDisplay(store, target, purpose, score, site, condition) {
  const keys = condition.keys;
  const specs = keys.map((key) => specFor(target, key)).filter(Boolean);
  const status = statusFromScore(score, keys);
  const layer = store.layersByKey[keys[0]] || {};

  let earth = "Not acquired";
  let targetText = "Target envelope pending";
  let basis = layer.basis || "Not measured in this build.";

  if (condition.id === "elevation_topography") {
    const relief = earthValue(site, "L1_elevation", score);
    const spec = specs[0];
    if (relief !== null) earth = `${num(relief, 1)} m relief`;
    if (spec) targetText = `${num(spec.target_val, 1)} m ± ${num(spec.tolerance, 1)} m`;
  } else if (condition.id === "slope") {
    const mean = earthValue(site, "L2_slope", score);
    const spec = specs[0];
    if (mean !== null) earth = `${num(mean, 2)}° median (${num(site.L2_slope_p95, 1)}° p95)`;
    if (spec) targetText = `${num(spec.target_val, 1)}° ± ${num(spec.tolerance, 1)}°`;
  } else if (condition.id === "roughness") {
    const tri = earthValue(site, "L3_roughness", score);
    const spec = specs[0];
    if (tri !== null) earth = `${num(tri, 2)} TRI (${num(site.L3_roughness_p95, 2)} p95)`;
    if (spec) targetText = `${num(spec.target_val, 2)} ± ${num(spec.tolerance, 2)} TRI`;
  } else if (condition.id === "temperature_extremes") {
    const tmin = earthValue(site, "L4_temperature_min", score);
    const tmax = earthValue(site, "L4_temperature_max", score);
    const maxSpec = specFor(target, "L4_temperature_max");
    const minSpec = specFor(target, "L4_temperature_min");
    if (tmin !== null && tmax !== null) earth = `${num(tmin, 1)}° to ${num(tmax, 1)}°C`;
    if (maxSpec && minSpec) {
      targetText = `${num(minSpec.target_val, 1)}°C to ${num(maxSpec.target_val, 1)}°C`;
    }
  } else if (condition.id === "illumination_low_sun") {
    const solar = earthValue(site, "L5_solar_illumination", score);
    const spec = specs[0];
    if (solar !== null) earth = `${num(solar, 0)} W/m² annual mean`;
    if (spec) targetText = `${num(spec.target_val, 0)} ± ${num(spec.tolerance, 0)} W/m²`;
  } else if (condition.id === "pressure") {
    const pressure = earthValue(site, "L6_surface_pressure", score);
    const spec = specs[0];
    if (pressure !== null) earth = `${num(pressure, 1)} kPa`;
    targetText = `${num(spec?.target_val ?? 0, 2)} kPa (excluded)`;
  } else if (condition.id === "dust_wind") {
    const aod = earthValue(site, "L9_dust_hazard", score);
    const spec = specs[0];
    if (aod !== null) earth = `AOD ${num(site.L9_aod_550, 2)} · ${num(site.wind_ms, 1)} m/s`;
    if (spec) targetText = `${num(spec.target_val, 2)} ± ${num(spec.tolerance, 2)} index`;
  } else if (condition.id === "ice_snow_moisture") {
    const spec = specs[0];
    if (spec) targetText = `${num(spec.target_val, 2)} ± ${num(spec.tolerance, 2)} % VWE`;
  } else if (condition.id === "geology_minerals") {
    const spec = specs[0];
    if (spec) targetText = `${num(spec.target_val, 2)} ± ${num(spec.tolerance, 2)} index`;
  } else if (condition.id === "craters_rocks") {
    const spec = specs[0];
    if (spec) targetText = `${num(spec.target_val, 1)} ± ${num(spec.tolerance, 1)} %`;
  } else if (condition.id === "caves_lava_tubes") {
    const spec = specs[0];
    if (spec) targetText = `${num(spec.target_val, 1)} ± ${num(spec.tolerance, 1)} km`;
  } else if (condition.id === "access_hazards") {
    targetText = "Context only · weight 0";
  }

  if (status === "Excluded") basis = "Reported, never scored: Earth cannot reproduce the target condition.";
  else if (status === "Missing") basis = "No Earth value acquired in this build.";

  return {
    ...condition,
    earth,
    target: targetText,
    basis,
    status,
    badge: badgeFor(status),
    statusLabel: STATUS[status]?.short || status,
  };
}

export function allConditionDisplays(store, target, purpose, score, site) {
  return CONDITIONS.map((condition) => conditionDisplay(store, target, purpose, score, site, condition));
}

export function byLabel(displays, label) {
  const norm = String(label || "").trim().toLowerCase();
  return (
    displays.find((d) => d.label.toLowerCase() === norm) ||
    displays.find((d) => norm.includes(d.label.toLowerCase().split(" ")[0])) ||
    null
  );
}

export function targetFacts(target) {
  const layer = (key) => target?.layers?.[key] || null;
  return {
    name: target?.target_name || "Planetary target",
    relief: layer("L1_elevation"),
    slope: layer("L2_slope"),
    roughness: layer("L3_roughness"),
    tempMax: layer("L4_temperature_max"),
    tempMin: layer("L4_temperature_min"),
    solar: layer("L5_solar_illumination"),
    pressure: layer("L6_surface_pressure"),
  };
}
