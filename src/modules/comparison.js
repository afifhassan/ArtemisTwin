/* ArtemisTwin — Site Detail and custom-site detail integration.
   Fills the existing detail sections with target-driven values, adds the
   interactive transect and exports, and renders a full custom-site view. */

import { routeKey, scoreFor } from "./state.js";
import { gapBlock, layerMatrix, liveBlock, scoreCard } from "./screening.js";
import { attachLive } from "./live-view.js";
import { ensureHost } from "./dom.js";
import { allConditionDisplays, byLabel, targetFacts } from "./metrics.js";
import { bindProfileCharts, renderProfileChart } from "./profile.js";
import { buildCustomScore, getActiveCustom } from "./custom-site.js";
import { num } from "./format.js";

const HOST_ID = "atf-detail-host";

function downloadFile(filename, text, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function buildMeasurementsCsv(store, target, purpose, score, site) {
  const displays = allConditionDisplays(store, target, purpose, score, site);
  const rows = [
    ["Condition", "Target_envelope", "Earth_value", "Basis", "Status", "Effective_weight"],
    ...displays.map((d) => [
      d.label,
      d.target,
      d.earth,
      d.basis,
      d.status,
      score?.layer_breakdown?.[d.keys[0]]?.effective_weight ?? "",
    ]),
    [],
    ["Fit_score", score?.fit_score ?? "", "Likely_low", score?.confidence_interval?.ci_lower_p10 ?? "", "Likely_high", score?.confidence_interval?.ci_upper_p90 ?? ""],
    ["Data_completeness_pct", score?.data_completeness_pct ?? "", "Layers_present", `${score?.layers_present ?? ""} of ${score?.layers_total ?? 12}`, "Method", store.methodVersion || ""],
    ["Target", target?.target_name ?? "", "Purpose", purpose?.purpose_name ?? "", "Site", site.site_name],
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function buildProfilesCsv(site) {
  const profile = site.profile_ew_m || [];
  const step = Number(site.profile_step_m) || 2000 / Math.max(1, profile.length - 1);
  const rows = [["Index", "Distance_m", "Elevation_m", "Step_m", "Site"]];
  profile.forEach((y, i) => rows.push([i, (i * step).toFixed(1), Number(y).toFixed(1), step, site.site_name]));
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

function buildGeoJson(site) {
  const b = site.terrain_bbox || {};
  const west = b.west ?? site.lon - 0.01;
  const east = b.east ?? site.lon + 0.01;
  const south = b.south ?? site.lat - 0.01;
  const north = b.north ?? site.lat + 0.01;
  const ring = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
  return JSON.stringify(
    {
      type: "Feature",
      properties: {
        site_id: site.site_id,
        site_name: site.site_name,
        window_km: site.window_km,
        custom: Boolean(site.custom),
        crs: "EPSG:4326",
        note: site.custom
          ? "User-selected window sampled on demand from AWS Terrarium z14. Not a surveyed or permitted boundary."
          : "Screening window; analytical sample, not an official boundary or land-access claim.",
      },
      geometry: { type: "Polygon", coordinates: [ring] },
    },
    null,
    2
  );
}

function bindExports(root, context) {
  if (root.dataset.atfExports === "1") {
    root._atfExportContext = context;
    return;
  }
  root.dataset.atfExports = "1";
  root._atfExportContext = context;
  root.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest("[data-export], [data-atf-export]");
      if (!button) return;
      const kind = button.dataset.export || button.dataset.atfExport;
      if (!kind) return;
      const ctx = root._atfExportContext;
      if (!ctx) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (kind === "csv") {
        downloadFile(`${ctx.site.site_id}_measurements.csv`, buildMeasurementsCsv(ctx.store, ctx.target, ctx.purpose, ctx.score, ctx.site));
      } else if (kind === "profiles") {
        downloadFile(`${ctx.site.site_id}_profiles.csv`, buildProfilesCsv(ctx.site));
      } else if (kind === "geojson") {
        downloadFile(`${ctx.site.site_id}_footprint.geojson`, buildGeoJson(ctx.site), "application/geo+json");
      }
    },
    true
  );
}

function dualFootprintHtml(store, target, site, { includeProfile = true } = {}) {
  const facts = targetFacts(target);
  const fmt = (spec, digits = 1) => (spec ? `${num(spec.target_val, digits)} ${spec.unit || ""}` : "—");
  const dual = `
    <div class="atf-dual">
      <figure class="atf-dual-fig">
        <figcaption><b>${target.target_name}</b><br><small>Target envelope · 2 × 2 km reference window</small></figcaption>
        <dl>
          <div><dt>Relief</dt><dd>${fmt(facts.relief)} ± ${num(facts.relief?.tolerance, 0)} m</dd></div>
          <div><dt>Slope median</dt><dd>${fmt(facts.slope, 1)} ± ${num(facts.slope?.tolerance, 0)}°</dd></div>
          <div><dt>Roughness</dt><dd>${num(facts.roughness?.target_val, 2)} TRI ± ${num(facts.roughness?.tolerance, 2)}</dd></div>
          <div><dt>Reference</dt><dd>${target.body} target envelope; LOLA/MOLA products</dd></div>
        </dl>
      </figure>
      <figure class="atf-dual-fig">
        <figcaption><b>${site.site_name}</b><br><small>${site.window_label || "2 × 2 km screening window"}</small></figcaption>
        <dl>
          <div><dt>Centre</dt><dd>${Math.abs(site.lat).toFixed(4)}° ${site.lat >= 0 ? "N" : "S"}, ${Math.abs(site.lon).toFixed(4)}° ${site.lon >= 0 ? "E" : "W"}</dd></div>
          <div><dt>Elevation</dt><dd>${num(site.L1_elevation_min_m, 1)}–${num(site.L1_elevation_max_m, 1)} m (mean ${num(site.L1_elevation_mean_m, 1)} m)</dd></div>
          <div><dt>Relief · slope</dt><dd>${num(site.L1_relief_m, 1)} m · ${num(site.L2_slope_mean, 2)}°</dd></div>
          <div><dt>Terrain source</dt><dd>${site.terrain_source || "AWS Terrain Tiles z14"}</dd></div>
        </dl>
      </figure>
    </div>`;
  if (!includeProfile) return dual;
  return `${dual}
    ${renderProfileChart(site, { compact: false }).replace('<div class="atf-profile-chart', '<div id="profile" class="atf-profile-chart')}`;
}

function barsHtml(target, site) {
  const facts = targetFacts(target);
  const rows = [
    { label: "Elevation & topography", target: facts.relief?.target_val, earth: site.L1_relief_m, unit: "m" },
    { label: "Slope, median", target: facts.slope?.target_val, earth: site.L2_slope_mean, unit: "°" },
    { label: "Roughness, TRI", target: facts.roughness?.target_val, earth: site.L3_roughness_mean, unit: "" },
  ];
  return `<ol class="atf-m3">${rows.map((row) => {
    const max = Math.max(1e-6, Number(row.target) || 0, Number(row.earth) || 0);
    return `<li>
      <p class="atf-m3-k">${row.label}</p>
      <p class="atf-m3-row"><span>Target envelope</span><span class="atf-m3-bar"><i style="width:${((Number(row.target) || 0) / max) * 100}%"></i></span><b>${num(row.target, 2)}${row.unit}</b></p>
      <p class="atf-m3-row atf-m3-earth"><span>${site.site_name}</span><span class="atf-m3-bar"><i style="width:${((Number(row.earth) || 0) / max) * 100}%"></i></span><b>${num(row.earth, 2)}${row.unit}</b></p>
    </li>`;
  }).join("")}</ol>`;
}

function updateTwelveConditions(body, store, target, purpose, score, site) {
  const table = body.querySelector(".dt-sec table.dt-ct") || body.querySelector("table.dt-ct");
  if (!table) return;
  const displays = allConditionDisplays(store, target, purpose, score, site);
  table.querySelectorAll("tbody tr").forEach((tr) => {
    const th = tr.querySelector("th");
    const label = th?.firstChild?.textContent?.trim() || th?.textContent?.trim() || "";
    const d = byLabel(displays, label);
    if (!d) return;
    const tds = tr.querySelectorAll("td");
    if (tds.length < 4) return;
    tds[0].innerHTML = d.target;
    tds[1].innerHTML = d.earth === "Not acquired" ? `<span class="uk">Not acquired</span>` : `<b>${d.earth}</b>`;
    tds[2].innerHTML = d.basis;
    tds[3].innerHTML = `<span class="atf-badge atf-badge-${d.badge}">${d.status}</span>`;
  });
}

function updateAllMeasurements(body, store, target, purpose, score, site) {
  const heading = body.querySelector("#dMs");
  if (!heading) return;
  const section = heading.closest("section") || heading.parentElement;
  if (!section) return;
  const displays = allConditionDisplays(store, target, purpose, score, site);
  const rows = displays.map((d) => `<tr><th scope="row">${d.label}</th><td>${d.target}</td><td>${d.earth}</td><td>${d.status}</td></tr>`).join("");
  const tableHtml = `<table class="mt atf-all-measure"><thead><tr><th scope="col">Condition</th><th scope="col">Target envelope</th><th scope="col">This site</th><th scope="col">Status</th></tr></thead><tbody>${rows}</tbody></table>`;
  let table = section.querySelector("table.atf-all-measure");
  if (table) {
    table.outerHTML = tableHtml;
    return;
  }
  const none = section.querySelector(".dt-none");
  if (none) {
    none.outerHTML = tableHtml;
    return;
  }
  table = section.querySelector("table.mt");
  if (table) {
    table.outerHTML = tableHtml;
  }
}

export function mountDetail(store, route) {
  const body = document.getElementById("detailBody");
  if (!body) return;
  const custom = getActiveCustom();
  const customFlag = sessionStorage.getItem("atf:custom-detail") === "1";
  if (
    (customFlag && custom && (route.site === "mcmurdo" || route.view === "site")) ||
    String(route.site || "").startsWith("custom_") ||
    (custom && custom.site.site_id === route.site)
  ) {
    mountCustomDetail(store, route, body, custom);
    document.documentElement.dataset.atfCustom = "1";
    return;
  }
  if (route.site !== "mcmurdo" || !customFlag) {
    sessionStorage.removeItem("atf:custom-detail");
  }
  document.documentElement.dataset.atfCustom = "0";
  body.classList.remove("atf-custom-active");
  body.querySelector("#atf-custom-detail")?.remove();
  const site = store.sitesById[route.site];
  if (!site) return;
  const target = store.targetsById[route.target] || store.targetList[0];
  const purpose = store.purposesById[route.purpose] || store.purposes[0];
  const score = scoreFor(store, route.target, route.purpose, site.site_id);
  if (!target || !purpose || !score) return;
  const detailKey = `native|${site.site_id}|${route.target}|${route.purpose}|${Math.round(score.fit_score)}`;
  if (body.dataset.atfDetailKey === detailKey && body.querySelector(".dt-fit strong")?.textContent === String(Math.round(score.fit_score)) && !body.querySelector(".profile.unavailable")) {
    return;
  }
  body.dataset.atfCustomKey = "";
  body.dataset.atfDetailKey = detailKey;
  const displays = allConditionDisplays(store, target, purpose, score, site);

  const sub = body.querySelector(".dt-sub");
  if (sub) sub.textContent = `${site.window_label || site.region} (${site.country}) · computed terrain & climate evidence`;

  const openH2 = body.querySelector(".dt-open h2");
  if (openH2) openH2.textContent = "Study window and measured conditions";

  const none = body.querySelector(".dt-win .ft.ft-none");
  if (none) none.outerHTML = dualFootprintHtml(store, target, site);

  const oldProfile = body.querySelector(".profile.unavailable");
  if (oldProfile) oldProfile.remove();

  const three = body.querySelector(".dt-three");
  if (three) {
    const keep = [...three.children]
      .filter((el) => !el.matches(".ms-h, .dt-big, .dt-none, .m3, .mn, .scl, .seg") && !el.classList.contains("seg"))
      .map((el) => el.outerHTML)
      .join("");
    three.innerHTML = `
      <div class="ms-h"><h3 id="dThree">Measured conditions</h3></div>
      <p class="dt-big">${score.layers_present} of 12</p>
      <p class="dt-none">${score.layers_present} conditions measured (${score.data_completeness_pct.toFixed(0)}% data completeness). ${score.layers_total - score.layers_present} conditions have no Earth value in this build.</p>
      ${barsHtml(target, site)}
      <p class="mn">Bars compare the declared target envelope with this 2 × 2 km Earth window. Missing conditions are named in the matrix below. Model ${store.methodVersion}.</p>
      ${keep}`;
  }

  const status = body.querySelector(".dt-sec.dt-status");
  if (status) {
    const cov = status.querySelectorAll(".dt-cov");
    if (cov[0]) {
      cov[0].querySelector(".v").textContent = `${score.layers_present} of 12`;
      cov[0].querySelector(".n").textContent = `${score.layers_present} conditions measured at this site.`;
      const bar = cov[0].querySelector(".cov-bar i");
      if (bar) bar.style.width = `${(score.layers_present / 12) * 100}%`;
    }
    if (cov[1]) {
      cov[1].querySelector(".k").textContent = `Comparable for ${target.target_name} · ${purpose.purpose_name}`;
      cov[1].querySelector(".v").textContent = `${score.layers_present} of 12`;
      cov[1].querySelector(".n").textContent = `${score.layers_present} conditions compared against the target envelope.`;
      const bar = cov[1].querySelector(".cov-bar i");
      if (bar) bar.style.width = `${(score.layers_present / 12) * 100}%`;
    }
    const fit = status.querySelector(".dt-fit");
    if (fit) {
      fit.querySelector(".v").innerHTML = `<strong>${Math.round(score.fit_score)}</strong> / 100`;
      fit.querySelector(".n").textContent = `Weighted similarity across measured conditions · likely ${num(score.confidence_interval?.ci_lower_p10, 0)}–${num(score.confidence_interval?.ci_upper_p90, 0)}. Screening similarity, not a match.`;
      fit.querySelectorAll("dl.fl > div").forEach((div) => {
        const dt = div.querySelector("dt")?.textContent?.trim();
        const dd = div.querySelector("dd");
        if (!dd) return;
        if (dt === "Purpose status") dd.textContent = `Screened for ${purpose.purpose_name}`;
        if (dt === "Access and permits") dd.textContent = site.note || `${site.country} · ${site.region}`;
      });
    }
    status.querySelectorAll("[data-export]").forEach((button) => button.removeAttribute("disabled"));
    status.querySelectorAll("p.n").forEach((p) => {
      if (/unavailable/i.test(p.textContent || "")) p.remove();
    });
  }

  updateTwelveConditions(body, store, target, purpose, score, site);
  updateAllMeasurements(body, store, target, purpose, score, site);
  bindExports(body, { store, target, purpose, score, site });
  bindProfileCharts(body);

  let host = body.querySelector(`#${HOST_ID}`);
  if (!host || !host.isConnected) {
    host = ensureHost(body, HOST_ID);
  }
  const key = routeKey(route);
  if (host.dataset.key === key) return;
  host.dataset.key = key;
  host.innerHTML = `<section class="atf-panel atf-live-panel">
    <div class="atf-cardhead"><div><p class="atf-kicker"><span class="atf-dot" aria-hidden="true"></span> Live NASA context</p>
    <h2 class="atf-h2 atf-h2-sm">Current context for this window</h2></div>
    <button type="button" class="atf-btn" data-atf-live-refresh>Refresh</button></div>
    <div class="atf-live" data-atf-live data-site="${site.site_id}">
      <p class="atf-live-line" data-live-power role="status">Fetching NASA POWER…</p>
      <p class="atf-live-line" data-live-eonet>Checking NASA EONET…</p>
    </div>
    <p class="atf-note">Live context only. The cached score is not silently overwritten; the live recompute is labelled.</p>
  </section>`;
  host.querySelector("[data-atf-live-refresh]")?.addEventListener("click", () => attachLive(host, { store, route, site, score }));
  attachLive(host, { store, route, site, score });
}

function customMeasurementsTableHtml(site) {
  return `
    <section class="atf-panel">
      <div class="atf-cardhead">
        <div>
          <p class="atf-kicker">Comprehensive Measurements</p>
          <h2 class="atf-h2 atf-h2-sm">Environmental & Climate Parameters</h2>
        </div>
        <span class="atf-chip">AWS Terrarium · NASA POWER</span>
      </div>
      <div class="atf-scroll" tabindex="0" role="region" aria-label="Measurements Table">
        <table class="atf-table">
          <thead>
            <tr>
              <th scope="col">Domain</th>
              <th scope="col">Condition / Parameter</th>
              <th scope="col">Measured Value</th>
              <th scope="col">Source / Basis</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th rowspan="8" scope="rowgroup">Terrain</th>
              <td>Mean elevation</td>
              <td><b>${num(site.L1_elevation_mean_m, 1)} m</b></td>
              <td>AWS Terrarium z14 DEM</td>
            </tr>
            <tr>
              <td>Min elevation</td>
              <td><b>${num(site.L1_elevation_min_m, 1)} m</b></td>
              <td>Lowest cell in 2 × 2 km window</td>
            </tr>
            <tr>
              <td>Max elevation</td>
              <td><b>${num(site.L1_elevation_max_m, 1)} m</b></td>
              <td>Highest cell in 2 × 2 km window</td>
            </tr>
            <tr>
              <td>Relief</td>
              <td><b>${num(site.L1_relief_m, 1)} m</b></td>
              <td>Max − Min difference</td>
            </tr>
            <tr>
              <td>Mean slope</td>
              <td><b>${num(site.L2_slope_mean, 2)}°</b></td>
              <td>Horn 3 × 3 gradient filter</td>
            </tr>
            <tr>
              <td>p95 slope</td>
              <td><b>${num(site.L2_slope_p95, 2)}°</b></td>
              <td>95th percentile slope</td>
            </tr>
            <tr>
              <td>Mean roughness (TRI)</td>
              <td><b>${num(site.L3_roughness_mean, 3)} TRI</b></td>
              <td>Terrain Ruggedness Index</td>
            </tr>
            <tr>
              <td>p95 roughness</td>
              <td><b>${num(site.L3_roughness_p95, 3)} TRI</b></td>
              <td>95th percentile roughness</td>
            </tr>

            <tr>
              <th rowspan="9" scope="rowgroup">Climate & Atmosphere</th>
              <td>Mean annual surface temperature</td>
              <td><b>${site.L4_temp_mean != null ? `${num(site.L4_temp_mean, 1)} °C` : "Not acquired"}</b></td>
              <td>NASA POWER MERRA-2 (TS)</td>
            </tr>
            <tr>
              <td>Min monthly temperature</td>
              <td><b>${site.L4_temp_min != null ? `${num(site.L4_temp_min, 1)} °C` : "Not acquired"}</b></td>
              <td>Coldest month climatology</td>
            </tr>
            <tr>
              <td>Max monthly temperature</td>
              <td><b>${site.L4_temp_max != null ? `${num(site.L4_temp_max, 1)} °C` : "Not acquired"}</b></td>
              <td>Warmest month climatology</td>
            </tr>
            <tr>
              <td>Solar irradiance</td>
              <td><b>${site.L5_solar_mean != null ? `${num(site.L5_solar_mean, 1)} W/m²` : "Not acquired"}</b></td>
              <td>All-sky downwelling SW (ALLSKY_SFC_SW_DWN)</td>
            </tr>
            <tr>
              <td>Surface atmospheric pressure</td>
              <td><b>${site.L6_pressure_mean != null ? `${num(site.L6_pressure_mean, 2)} kPa` : "Not acquired"}</b></td>
              <td>Surface pressure (PS) · reported, excluded from fit</td>
            </tr>
            <tr>
              <td>Wind speed</td>
              <td><b>${site.wind_ms != null ? `${num(site.wind_ms, 2)} m/s` : "Not acquired"}</b></td>
              <td>2m wind speed (WS2M)</td>
            </tr>
            <tr>
              <td>Annual precipitation</td>
              <td><b>${site.rain_mm_year != null ? `${num(site.rain_mm_year, 1)} mm/year` : "Not acquired"}</b></td>
              <td>Precipitation climatology (PRECTOTCORR)</td>
            </tr>
            <tr>
              <td>Relative humidity</td>
              <td><b>${site.rh_pct != null ? `${num(site.rh_pct, 1)} %` : "Not acquired"}</b></td>
              <td>2m relative humidity (RH2M)</td>
            </tr>
            <tr>
              <td>Aerosol Optical Depth / Dust Index</td>
              <td><b>${site.L9_aod_550 != null ? `${num(site.L9_aod_550, 3)} (Dust index ${num(site.L9_dust_idx, 2)})` : "Not acquired"}</b></td>
              <td>AOD 550 nm (AOD_55)</td>
            </tr>

            <tr>
              <th rowspan="5" scope="rowgroup">Status & Gaps</th>
              <td>Ice / volatiles (L7)</td>
              <td><span class="uk">Unmeasured in this build</span></td>
              <td>No ground-truth volatile survey available</td>
            </tr>
            <tr>
              <td>Mineralogy (L8)</td>
              <td><span class="uk">Unmeasured in this build</span></td>
              <td>Compositional spectra not sampled</td>
            </tr>
            <tr>
              <td>Rock abundance (L10)</td>
              <td><span class="uk">Unmeasured in this build</span></td>
              <td>Sub-meter boulder distribution unmeasured</td>
            </tr>
            <tr>
              <td>Cave proximity (L11)</td>
              <td><span class="uk">Unmeasured in this build</span></td>
              <td>Subsurface voids not surveyed</td>
            </tr>
            <tr>
              <td>Access & logistics (L12)</td>
              <td><span class="uk">Unmeasured in this build</span></td>
              <td>User-selected point; permits/access not validated</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="atf-note">7 of 12 condition groups measured in-browser (58% data completeness). Missing conditions are not imputed as zero; weighted fit scoring renormalizes across measured layers only.</p>
    </section>
  `;
}

function customDetailHtml(store, route, custom) {
  const site = custom.site;
  const target = store.targetsById[route.target] || store.targetList[0];
  const purpose = store.purposesById[route.purpose] || store.purposes[0];
  const score = buildCustomScore(store, site, target, purpose);
  return {
    score,
    html: `
    <div class="dt-top">
      <a class="dt-back" href="#/map?target=${encodeURIComponent(route.target)}&purpose=${encodeURIComponent(route.purpose)}" data-custom-back>← Back to Match Map</a>
      <h1 class="dt-h">Custom location</h1>
      <p class="dt-sel cx"><span><small>Target</small><b>${target.target_name}</b></span><span><small>Purpose</small><b>${purpose.purpose_name}</b></span></p>
      <p class="dt-sub">${site.lat.toFixed(4)}°, ${site.lon.toFixed(4)}° · user-selected 2 × 2 km window · sampled in-browser from AWS Terrarium and NASA POWER. Not a surveyed or permitted site.</p>
    </div>
    <div class="atf-host atf-custom-detail">
      ${scoreCard(store, { ...route, site: site.site_id }, site, score)}
      <section class="atf-panel">
        <div class="atf-cardhead"><div><p class="atf-kicker">Study window</p><h2 class="atf-h2 atf-h2-sm">2 × 2 km sample</h2></div><span class="atf-chip">User-selected</span></div>
        ${dualFootprintHtml(store, target, site, { includeProfile: false })}
        <div class="atf-m3-wrap" style="margin-top:1.5rem;">
          <h3 class="atf-h3" style="margin-bottom:0.75rem;">Topographic Envelope Comparison</h3>
          ${barsHtml(target, site)}
        </div>
        <dl class="atf-facts atf-facts-wide" style="margin-top:1.5rem;">
          <div><dt>Centre</dt><dd>${site.lat.toFixed(4)}°, ${site.lon.toFixed(4)}°</dd></div>
          <div><dt>Bounding box</dt><dd>${site.terrain_bbox?.west?.toFixed(3)}–${site.terrain_bbox?.east?.toFixed(3)}°, ${site.terrain_bbox?.south?.toFixed(3)}–${site.terrain_bbox?.north?.toFixed(3)}°</dd></div>
          <div><dt>Grid</dt><dd>${site.grid_cell_m} m · 49-point transect</dd></div>
        </dl>
      </section>
      <section class="atf-panel">
        <div class="atf-cardhead"><div><p class="atf-kicker">Terrain Transect</p><h2 class="atf-h2 atf-h2-sm">East–West Elevation Profile (49-point sample)</h2></div></div>
        <div id="atf-custom-profile" class="profile ready">
          ${renderProfileChart(site, { compact: false })}
        </div>
        <p class="atf-note">Derived from AWS Terrarium z14 tiles at ~12.5 m native resolution. 2 × 2 km study footprint.</p>
      </section>
      ${customMeasurementsTableHtml(site)}
      ${layerMatrix(store, { ...route, site: site.site_id }, score)}
      ${gapBlock(store, { ...route, site: site.site_id }, score)}
      <section class="atf-panel">
        <div class="atf-cardhead"><div><p class="atf-kicker">Export</p><h2 class="atf-h2 atf-h2-sm">Take the window with you</h2></div></div>
        <div class="atf-export-row">
          <button type="button" class="atf-btn" data-atf-export="csv">Measurements CSV</button>
          <button type="button" class="atf-btn" data-atf-export="profiles">Elevation profile CSV</button>
          <button type="button" class="atf-btn" data-atf-export="geojson">Study footprint GeoJSON</button>
        </div>
        <p class="atf-note">The exports record the sampled values, target envelope, method version and the fact that this is a user-selected window.</p>
      </section>
      ${liveBlock(site)}
    </div>`,
  };
}

function mountCustomDetail(store, route, body, custom) {
  if (!custom || (route.site !== "mcmurdo" && custom.site.site_id !== route.site)) {
    body.innerHTML = `<div class="atf-host"><section class="atf-panel"><p class="atf-kicker">Custom site</p><h1 class="atf-h2">No sampled window is stored</h1><p class="atf-note">Explore the map to sample a custom 2 × 2 km window, then open its detail from the inspector.</p><p><a class="atf-btn" href="#/map?target=${encodeURIComponent(route.target)}&purpose=${encodeURIComponent(route.purpose)}">Back to Match Map</a></p></section></div>`;
    return;
  }
  const customKey = `custom|${custom.site.site_id}|${route.target}|${route.purpose}`;
  let overlay = body.querySelector("#atf-custom-detail");
  if (overlay && body.dataset.atfCustomKey === customKey) return;
  body.dataset.atfCustomKey = customKey;
  body.classList.add("atf-custom-active");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "atf-custom-detail";
    body.appendChild(overlay);
  }
  const target = store.targetsById[route.target] || store.targetList[0];
  const purpose = store.purposesById[route.purpose] || store.purposes[0];
  const built = customDetailHtml(store, route, custom);
  overlay.innerHTML = built.html;
  overlay.dataset.key = customKey;
  overlay.querySelector("[data-custom-back]")?.addEventListener("click", (event) => {
    event.preventDefault();
    sessionStorage.removeItem("atf:custom-detail");
    sessionStorage.setItem("atf:custom-mode", "1");
    body.classList.remove("atf-custom-active");
    overlay.remove();
    delete body.dataset.atfCustomKey;
    location.hash = `#/map?target=${encodeURIComponent(route.target)}&purpose=${encodeURIComponent(route.purpose)}`;
  });
  bindProfileCharts(overlay);
  bindExports(overlay, { store, target, purpose, score: built.score, site: custom.site });
  attachLive(overlay, { store, route, site: custom.site, score: built.score });
  overlay.querySelector("[data-atf-live-refresh]")?.addEventListener("click", () => attachLive(overlay, { store, route, site: custom.site, score: built.score }));
}
