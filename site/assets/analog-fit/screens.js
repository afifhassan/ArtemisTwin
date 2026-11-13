/* ArtemisTwin — start screen, map-band controls and inspector wiring.
   All mutations are additive: the original bundle markup is filled in place,
   never re-created wholesale except for the custom-location inspector. */

import { openSite, routeKey, scoreFor } from "./state.js";
import { inspectorCard, overview } from "./screening.js";
import { attachLive } from "./live-view.js";
import { bindOpenButtons, ensureHost } from "./dom.js";
import {
  clearCustomLocation,
  fitAllSites,
  mapLayerState,
  setExploreMode,
  setOverlay,
  setSitesVisible,
  showCustomLocation,
  syncMap,
} from "./map.js";
import { allConditionDisplays, byLabel, CONDITIONS } from "./metrics.js";
import { renderProfileChart, bindProfileCharts } from "./profile.js";
import {
  buildCustomScore,
  customEvents,
  getActiveCustom,
  runCustomSample,
  setActiveCustom,
} from "./custom-site.js";
import { num } from "./format.js";

const START_ID = "atf-start-host";
const MAP_ID = "atf-map-host";
const INSP_ID = "atf-insp-host";

let activeStore = null;
let activeRoute = null;
let customMode = false;
let customAbort = null;
let sampling = false;

export function renderProfileSvg(profile_ew_m, minM, maxM, reliefM, siteId = "site") {
  const site = {
    site_id: siteId,
    profile_ew_m,
    L1_relief_m: reliefM,
    L1_elevation_min_m: minM,
    L1_elevation_max_m: maxM,
    site_name: siteId,
  };
  return renderProfileChart(site, { compact: false });
}

export function getConditionDisplay(label, site, score, store = activeStore, target = null, purpose = null) {
  const t = target || store?.targetsById?.[activeRoute?.target] || store?.targetList?.[0];
  const p = purpose || store?.purposesById?.[activeRoute?.purpose] || store?.purposes?.[0];
  if (!store || !t || !p) return { val: "Not acquired", status: "Missing", key: "na" };
  const displays = allConditionDisplays(store, t, p, score, site);
  const d = byLabel(displays, label);
  return d
    ? { val: d.earth, status: d.status, key: d.badge, target: d.target, basis: d.basis }
    : { val: "Not acquired", status: "Missing", key: "na" };
}

function badgeHtml(key, label) {
  return `<b class="atf-badge atf-badge-${key}">${label}</b>`;
}

function nativeConditionList(score, site, target, purpose) {
  const emphasis = new Set(purpose.emphasis || []);
  return allConditionDisplays(activeStore, target, purpose, score, site)
    .map((d) => {
      const em = emphasis.has(d.id);
      return `<li${em ? ` class="em"` : ""}>${d.label}${em ? `<em>Emphasized for ${purpose.purpose_name}</em>` : ""}<span>${d.earth} <b class="atf-badge atf-badge-${d.badge}">${d.status}</b><small>${d.target}</small></span></li>`;
    })
    .join("");
}

function updateNativeInspector(store, route, site, score, target, purpose) {
  const insp = document.getElementById("insp");
  if (!insp) return;
  const ib = insp.querySelector(".ib");
  if (ib) ib.classList.remove("atf-custom-insp");
  insp.querySelector(".ib > .pv")?.remove();
  const h2 = insp.querySelector(".ib > h2, h2");
  if (h2) h2.textContent = site.site_name;
  const sub = insp.querySelector(".ib > .sub");
  if (sub) sub.textContent = site.window_label || `${site.region}, ${site.country}`;
  const warn = insp.querySelector(".dt-warn");
  if (warn) {
    warn.innerHTML = `<b>Provisional screening model.</b> The catalog's own Fit stays unset; this added model compares documented Earth values with the target envelope. It is not a match or a safety rating.`;
  }
  const fit = insp.querySelector(".fl");
  if (fit) {
    fit.innerHTML = `
      <div><dt>Fit</dt><dd><strong>${Math.round(score.fit_score)}</strong> / 100 <small style="display:block;font-size:.75em;color:#aaa">likely ${score.confidence_interval?.ci_lower_p10?.toFixed(0)}–${score.confidence_interval?.ci_upper_p90?.toFixed(0)}</small></dd></div>
      <div><dt>Comparable conditions</dt><dd><strong>${score.layers_present} of 12</strong> measured</dd></div>
      <div><dt>Purpose status</dt><dd>Screened for ${purpose.purpose_name}</dd></div>
      <div><dt>Access and permits</dt><dd>${site.country} · ${site.region}</dd></div>`;
  }
  const insGo = insp.querySelector(".ins-go");
  if (insGo) {
    insGo.innerHTML = `<a class="go-sm" href="#/site/${encodeURIComponent(site.site_id)}?target=${encodeURIComponent(route.target)}&purpose=${encodeURIComponent(route.purpose)}">Open Site Detail</a>`;
  }
  const list = insp.querySelector(".cl");
  if (list) list.innerHTML = nativeConditionList(score, site, target, purpose);
  const cn = insp.querySelector(".cn");
  if (cn) {
    cn.textContent = `${score.layers_present} of 12 conditions measured (${score.data_completeness_pct.toFixed(0)}% data completeness). ${score.layers_total - score.layers_present} unmeasured gaps. Model ${store.methodVersion}.`;
  }
  const prof = insp.querySelector("#profile");
  if (prof) {
    prof.className = "profile ready";
    prof.innerHTML = renderProfileChart(site, { compact: true });
    bindProfileCharts(prof);
  }
  const gp = insp.querySelector(".gp");
  if (gp) gp.textContent = "Terrain resemblance alone does not reproduce the lunar environment. Gravity, vacuum, radiation and true polar lighting remain limitations.";
  const rgNote = insp.querySelector(".rg p");
  if (rgNote) rgNote.textContent = `Model ${store.methodVersion} · live POWER/EONET context below · catalog Fit remains unset.`;
}

function mountLiveOnly(insp, store, route, site, score) {
  const key = `live|${site.site_id}|${routeKey(route)}`;
  let host = insp.querySelector(`#${INSP_ID}`);
  if (host && host.dataset.key === key) return;
  host = ensureHost(insp, INSP_ID, "atf-insp-host");
  const anchor = insp.querySelector(".ib > .cn") || insp.querySelector(".ib > .cl") || insp.querySelector(".ib");
  if (anchor && host.previousElementSibling !== anchor) anchor.insertAdjacentElement("afterend", host);
  host.dataset.key = key;
  host.innerHTML = `
    <div class="atf-live atf-live-compact" data-atf-live data-site="${site.site_id}">
      <p class="atf-live-k"><span class="atf-dot" aria-hidden="true"></span> Live NASA context</p>
      <p class="atf-live-line" data-live-power role="status">Fetching NASA POWER…</p>
      <p class="atf-live-line" data-live-eonet>Checking NASA EONET…</p>
    </div>`;
  attachLive(host, { store, route, site, score });
}

export function resolveActiveSiteId(store, route) {
  if (route.site && store.sitesById[route.site]) return route.site;
  const pressed = document.querySelector("#names button[aria-pressed='true'], #names li .nm[aria-pressed='true']");
  const pressedId = pressed?.closest("li")?.dataset?.id || pressed?.dataset?.id;
  if (pressedId && store.sitesById[pressedId]) return pressedId;
  const ident = document.querySelector("#names [data-ident^='site:']");
  if (ident) {
    const m = ident.dataset.ident.match(/^site:(.+)$/);
    if (m && store.sitesById[m[1]]) return m[1];
  }
  return store.siteList[0]?.site_id || "mcmurdo";
}

function customInspectorHtml(store, route, custom) {
  const target = store.targetsById[route.target] || store.targetList[0];
  const purpose = store.purposesById[route.purpose] || store.purposes[0];
  const score = buildCustomScore(store, custom.site, target, purpose);
  const site = custom.site;
  const displays = allConditionDisplays(store, target, purpose, score, site);
  return {
    score,
    html: `
    <div class="ib atf-custom-insp">
      <p class="pv"><b>Custom window</b> User-selected 2 × 2 km sample, not a surveyed or permitted site.</p>
      <h2>${site.site_name}</h2>
      <p class="sub">${site.lat.toFixed(4)}°, ${site.lon.toFixed(4)}° · ${target.target_name} · ${purpose.purpose_name}</p>
      <dl class="fl">
        <div><dt>Fit</dt><dd><strong>${Math.round(score.fit_score)}</strong> / 100 <small style="display:block;font-size:.75em;color:#aaa">likely ${score.confidence_interval.ci_lower_p10.toFixed(0)}–${score.confidence_interval.ci_upper_p90.toFixed(0)}</small></dd></div>
        <div><dt>Comparable conditions</dt><dd><strong>${score.layers_present} of 12</strong> measured</dd></div>
        <div><dt>Purpose status</dt><dd>Sampled for ${purpose.purpose_name}</dd></div>
        <div><dt>Access and permits</dt><dd>Not checked — user-selected point</dd></div>
      </dl>
      <p class="ins-go">
        <button type="button" class="go-sm" data-custom-open-detail>Open Custom Site Detail</button>
        <button type="button" class="atf-btn atf-btn-sm" data-custom-clear>Clear custom site</button>
      </p>
      <ul class="cl" aria-label="Twelve conditions">${displays.map((d) => {
        const em = (purpose.emphasis || []).includes(d.id);
        return `<li${em ? ` class="em"` : ""}>${d.label}${em ? `<em>Emphasized for ${purpose.purpose_name}</em>` : ""}<span>${d.earth} <b class="atf-badge atf-badge-${d.badge}">${d.status}</b><small>${d.target}</small></span></li>`;
      }).join("")}</ul>
      <p class="cn">${score.layers_present} of 12 conditions measured (${score.data_completeness_pct.toFixed(0)}% data completeness). Missing conditions are named in the detail view.</p>
      <div id="profile" class="profile ready">${renderProfileChart(site, { compact: true })}</div>
      <div class="atf-live atf-live-compact" data-atf-live data-site="${site.site_id}">
        <p class="atf-live-k"><span class="atf-dot" aria-hidden="true"></span> Live NASA context</p>
        <p class="atf-live-line" data-live-power role="status">Fetching NASA POWER…</p>
        <p class="atf-live-line" data-live-eonet>Checking NASA EONET…</p>
      </div>
      <p class="gp">Terrain resemblance alone does not reproduce the lunar environment. Gravity, vacuum, radiation and true polar lighting remain limitations.</p>
    </div>`,
  };
}

function renderCustomInspector(store, route, custom) {
  const insp = document.getElementById("insp");
  if (!insp) return;
  const key = `custom|${custom.site.site_id}|${route.target}|${route.purpose}`;
  if (insp.dataset.atfInspectorKey === key && insp.querySelector(".atf-custom-insp")) return;
  insp.dataset.atfInspectorKey = key;
  const { score, html } = customInspectorHtml(store, route, custom);
  insp.innerHTML = html;
  bindProfileCharts(insp);
  insp.querySelector("[data-custom-clear]")?.addEventListener("click", () => {
    sessionStorage.removeItem("atf:custom-detail");
    sessionStorage.removeItem("atf:custom-mode");
    setActiveCustom(null);
    customMode = false;
    clearCustomLocation();
    mountInspector(store, route);
  });
  insp.querySelector("[data-custom-open-detail]")?.addEventListener("click", () => {
    // Use a valid catalog route as the app shell; comparison.js swaps in the
    // custom detail and the flag survives a reload.
    sessionStorage.setItem("atf:custom-detail", "1");
    sessionStorage.setItem("atf:custom-mode", "1");
    location.hash = `#/site/mcmurdo?target=${encodeURIComponent(route.target)}&purpose=${encodeURIComponent(route.purpose)}`;
  });
  attachLive(insp, { store, route, site: custom.site, score });
}

function showSamplingState(lat, lon) {
  const insp = document.getElementById("insp");
  if (!insp) return;
  insp.innerHTML = `<div class="ib"><p class="pv"><b>Sampling custom window</b></p>
    <h2>${lat.toFixed(3)}°, ${lon.toFixed(3)}°</h2>
    <p class="sub">Reading Terrarium z14 terrain and NASA POWER climatology…</p>
    <div class="cmp-state pending" role="status"><p data-custom-status>Sampling 2 × 2 km window…</p></div>
    <ul class="cl">${CONDITIONS.map((d) => `<li>${d.label}<span>Pending</span></li>`).join("")}</ul></div>`;
}

async function handleCustomClick(store, route, lngLat) {
  if (sampling) return;
  sampling = true;
  customAbort?.abort();
  const ctrl = new AbortController();
  customAbort = ctrl;
  setActiveCustom(null);
  customMode = true;
  const lat = Number(lngLat.lat);
  const lon = Number(lngLat.lng);
  showSamplingState(lat, lon);
  try {
    const payload = await runCustomSample(store, lat, lon, {
      signal: ctrl.signal,
      onStatus: (text) => {
        const el = document.querySelector("[data-custom-status]");
        if (el) el.textContent = text;
      },
    });
    if (ctrl.signal.aborted) return;
    setActiveCustom(payload);
    sessionStorage.setItem("atf:custom-mode", "1");
    await showCustomLocation(lat, lon, { zoom: 11 });
    renderCustomInspector(store, route, payload);
    sampling = false;
    updateMapPanelCustom(payload);
  } catch (error) {
    if (ctrl.signal.aborted) return;
    sampling = false;
    const insp = document.getElementById("insp");
    if (insp) {
      insp.innerHTML = `<div class="ib"><h2>Custom window unavailable</h2>
        <p class="dt-warn">Terrain or climate sampling failed: ${String(error.message || error)}. The public Terrarium tiles and NASA POWER endpoint may be unreachable from this browser.</p>
        <p class="ins-go"><button type="button" class="atf-btn atf-btn-sm" data-custom-clear>Clear and retry</button></p></div>`;
      insp.querySelector("[data-custom-clear]")?.addEventListener("click", () => {
        customMode = false;
        clearCustomLocation();
        mountInspector(store, route);
      });
    }
  } finally {
    sampling = false;
  }
}

function homeCustomSectionHtml(store, route, custom) {
  const target = store.targetsById[route.target] || store.targetList[0];
  const purpose = store.purposesById[route.purpose] || store.purposes[0];

  let activeCard = "";
  if (custom?.site) {
    const site = custom.site;
    const score = buildCustomScore(store, site, target, purpose);
    const fitVal = Math.round(score.fit_score);
    const low = num(score.confidence_interval?.ci_lower_p10, 0);
    const high = num(score.confidence_interval?.ci_upper_p90, 0);
    const thin = score.evidence_status === "thin";

    activeCard = `
      <div class="atf-home-active-box">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
          <div>
            <p class="atf-kicker">Active Custom Screening Window</p>
            <h3 class="atf-h3" style="margin:2px 0 6px;color:var(--color-panel-ink);font-size:15px;">${site.site_name}</h3>
            <p class="atf-note" style="margin:0 0 10px;">${site.lat.toFixed(4)}°, ${site.lon.toFixed(4)}° · 2 × 2 km sampled window</p>
          </div>
          <span class="atf-chip atf-chip-${thin ? 'warn' : 'ok'}">${thin ? 'Thin evidence' : 'Screened'}</span>
        </div>
        <div class="atf-home-active-metrics">
          <dl>
            <div><dt>Coordinates</dt><dd>${site.lat.toFixed(4)}°, ${site.lon.toFixed(4)}°</dd></div>
            <div><dt>Relief</dt><dd>${num(site.L1_relief_m, 1)} m</dd></div>
            <div><dt>Slope</dt><dd>${num(site.L2_slope_mean, 2)}°</dd></div>
            <div><dt>Analog Fit</dt><dd><strong>${fitVal}</strong> / 100</dd></div>
            <div><dt>Likely Range</dt><dd>p10–p90: ${low}–${high}</dd></div>
            <div><dt>Evidence Status</dt><dd>${thin ? 'Thin evidence' : 'Screened'}</dd></div>
          </dl>
        </div>
        <div class="atf-home-active-actions">
          <button type="button" class="atf-btn atf-btn-primary" data-home-custom-open>Open Custom Site Detail</button>
          <button type="button" class="atf-btn atf-btn-sm" data-home-custom-clear>Clear Custom Site</button>
        </div>
      </div>`;
  }

  return `
    <section class="atf-panel atf-custom-home-card" aria-labelledby="atfHomeCustomH">
      <div class="atf-cardhead">
        <div>
          <p class="atf-kicker">Custom Window Screening</p>
          <h2 class="atf-h2 atf-h2-sm" id="atfHomeCustomH">Sample Custom Window</h2>
          <p class="atf-sub">Sample on-demand terrain (Terrarium z14) and NASA POWER climatology for any coordinates</p>
        </div>
        <span class="atf-chip">On-demand</span>
      </div>
      ${activeCard}
      <form class="atf-custom-home-form" data-home-custom-form onsubmit="return false;">
        <div class="atf-input-row">
          <div class="atf-field">
            <label for="atf-home-lat">Latitude (-90 to 90)</label>
            <input type="number" step="any" min="-90" max="90" id="atf-home-lat" class="atf-input" placeholder="e.g. 28.5721" value="${custom?.site?.lat != null ? custom.site.lat : ''}" required>
          </div>
          <div class="atf-field">
            <label for="atf-home-lon">Longitude (-180 to 180)</label>
            <input type="number" step="any" min="-180" max="180" id="atf-home-lon" class="atf-input" placeholder="e.g. -80.6480" value="${custom?.site?.lon != null ? custom.site.lon : ''}" required>
          </div>
          <button type="button" class="atf-btn atf-btn-primary" data-home-custom-sample>Sample Custom Window</button>
        </div>
        <div style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <a class="atf-link" href="#/map?target=${encodeURIComponent(route.target)}&purpose=${encodeURIComponent(route.purpose)}" data-home-explore-map>Or explore and sample interactively on Match Map →</a>
          <p class="atf-note" data-home-custom-status style="margin:0;"></p>
        </div>
      </form>
    </section>`;
}

function bindHomeCustomEvents(host, store, route) {
  host.querySelector("[data-home-custom-open]")?.addEventListener("click", () => {
    sessionStorage.setItem("atf:custom-detail", "1");
    sessionStorage.setItem("atf:custom-mode", "1");
    location.hash = `#/site/mcmurdo?target=${encodeURIComponent(route.target)}&purpose=${encodeURIComponent(route.purpose)}`;
  });

  host.querySelector("[data-home-custom-clear]")?.addEventListener("click", () => {
    sessionStorage.removeItem("atf:custom-detail");
    sessionStorage.removeItem("atf:custom-mode");
    setActiveCustom(null);
    clearCustomLocation();
    mountStart(store, route);
  });

  const sampleBtn = host.querySelector("[data-home-custom-sample]");
  sampleBtn?.addEventListener("click", async () => {
    const latInput = host.querySelector("#atf-home-lat");
    const lonInput = host.querySelector("#atf-home-lon");
    const statusEl = host.querySelector("[data-home-custom-status]");
    const lat = parseFloat(latInput?.value);
    const lon = parseFloat(lonInput?.value);

    if (isNaN(lat) || lat < -90 || lat > 90) {
      if (statusEl) statusEl.textContent = "Please enter a valid latitude between -90 and 90.";
      return;
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      if (statusEl) statusEl.textContent = "Please enter a valid longitude between -180 and 180.";
      return;
    }

    if (statusEl) statusEl.textContent = "Sampling terrain & climate data…";
    sampleBtn.disabled = true;
    sampleBtn.textContent = "Sampling…";

    try {
      const payload = await runCustomSample(store, lat, lon, {
        onStatus: (text) => {
          if (statusEl) statusEl.textContent = text;
        },
      });
      setActiveCustom(payload);
      sessionStorage.setItem("atf:custom-detail", "1");
      sessionStorage.setItem("atf:custom-mode", "1");
      location.hash = `#/site/mcmurdo?target=${encodeURIComponent(route.target)}&purpose=${encodeURIComponent(route.purpose)}`;
    } catch (err) {
      sampleBtn.disabled = false;
      sampleBtn.textContent = "Sample Custom Window";
      if (statusEl) statusEl.textContent = `Sampling failed: ${err.message || err}`;
    }
  });
}

export function mountStart(store, route) {
  const body = document.getElementById("startBody");
  if (!body) return;
  const custom = getActiveCustom();
  const key = `${routeKey(route)}|${custom?.site?.site_id || "none"}`;
  let host = body.querySelector(`#${START_ID}`);
  if (host && host.isConnected && host.dataset.key === key) {
    syncMap(store, route);
    return;
  }
  host = ensureHost(body, START_ID);
  host.dataset.key = key;
  host.innerHTML = `
    ${homeCustomSectionHtml(store, route, custom)}
    ${overview(store, route)}
    <details class="atf-panel atf-method">
      <summary class="atf-summary">How the screening model works</summary>
      <div class="atf-method-body">
        <p>Twelve condition groups are compared inside a 2 × 2 km window: relief, slope, roughness, temperature range, solar irradiance, pressure, ice, mineralogy, dust, rock cover, cave proximity and access.</p>
        <ul class="atf-list">
          <li><strong>Fit</strong> = weighted similarity, 0–100. Weights change with purpose and are listed in the matrix.</li>
          <li><strong>Likely range</strong> = 10th–90th percentile from 4,000 Monte Carlo draws over measurement, envelope and weight uncertainty. It is not a probability of mission success.</li>
          <li><strong>Data completeness</strong> = how many of the 12 layer groups have an Earth value. Missing layers are never imputed as zero.</li>
          <li><strong>Proxy layers</strong> (skin temperature, irradiance, AOD) carry half weight. Pressure is reported but excluded because no Earth surface site reproduces a vacuum or the Martian atmosphere.</li>
        </ul>
        <p class="atf-note">Gravity, radiation and true polar lighting are not in the fit. Choosing a desert cannot change them.</p>
        <p class="atf-src">Model ${store.methodVersion || ""} · generated ${store.generated || "unknown"} · sources in <a href="data/provenance.json" target="_blank" rel="noopener">provenance.json</a>.</p>
      </div>
    </details>`;
  bindOpenButtons(host, route, openSite);
  bindHomeCustomEvents(host, store, route);
  syncMap(store, route);
}

function updateMapPanelCustom(custom) {
  const el = document.querySelector("[data-atf-custom-state]");
  if (!el) return;
  if (!custom) {
    el.textContent = "Click “Explore custom location”, then click anywhere on the map.";
    el.removeAttribute("data-active");
    return;
  }
  el.dataset.active = "1";
  el.innerHTML = `Custom window <b>${custom.site.lat.toFixed(3)}°, ${custom.site.lon.toFixed(3)}°</b> · ${custom.site.L1_relief_m} m relief · ${custom.site.L2_slope_mean}° slope · <button type="button" class="atf-link" data-custom-clear-map>Clear</button>`;
  el.querySelector("[data-custom-clear-map]")?.addEventListener("click", () => {
    sessionStorage.removeItem("atf:custom-detail");
    sessionStorage.removeItem("atf:custom-mode");
    setActiveCustom(null);
    customMode = false;
    clearCustomLocation();
    updateMapPanelCustom(null);
    const route = activeRoute;
    if (route) mountInspector(activeStore, route);
  });
}

export function mountMapBand(store, route) {
  activeStore = store;
  activeRoute = route;
  const band = document.querySelector(".mb-k");
  if (!band) return;
  const key = `map|${route.target}|${route.purpose}`;
  let host = band.querySelector(`#${MAP_ID}`);
  if (host && host.isConnected && host.dataset.key === key) {
    syncMap(store, route);
    updateMapPanelCustom(getActiveCustom());
    return;
  }
  host = ensureHost(band, MAP_ID, "atf-map-host");
  const note = band.querySelector("#mapNote");
  if (note) note.insertAdjacentElement("beforebegin", host);
  host.dataset.key = key;
  host.innerHTML = `
    <details class="atf-mapctl" open>
      <summary class="atf-summary">Screening layers</summary>
      <div class="atf-toggles">
        <label><input type="checkbox" data-atf-layer="sites" checked> 7 screening windows</label>
        <label><input type="checkbox" data-atf-layer="lst"> MODIS land-surface temp (day)</label>
        <label><input type="checkbox" data-atf-layer="aod"> MODIS aerosol optical depth</label>
      </div>
      <div class="atf-map-actions">
        <button type="button" class="atf-btn atf-btn-sm" data-atf-fitall>Fit all 7 windows</button>
        <button type="button" class="atf-btn atf-btn-sm" data-atf-explore aria-pressed="false">Explore custom location</button>
      </div>
      <p class="atf-mini" data-atf-custom-state>Click “Explore custom location”, then click anywhere on the map.</p>
      <p class="atf-mini" data-atf-mapstate>Markers show the modelled fit for ${route.target.replaceAll("_", " ")} · ${route.purpose.replaceAll("_", " ")}. Select one to open its Site Detail.</p>
      <p class="atf-mini atf-attr">Overlays: NASA GIBS, live tiles. Context only.</p>
    </details>`;

  host.querySelectorAll("[data-atf-layer]").forEach((input) => {
    const layer = input.dataset.atfLayer;
    input.checked = Boolean(mapLayerState()[layer]);
    input.addEventListener("change", () => {
      if (layer === "sites") setSitesVisible(input.checked);
      else setOverlay(layer, input.checked);
    });
  });
  host.querySelector("[data-atf-fitall]")?.addEventListener("click", () => fitAllSites());

  const exploreBtn = host.querySelector("[data-atf-explore]");
  const setExploreUi = (on) => {
    if (!exploreBtn) return;
    exploreBtn.setAttribute("aria-pressed", on ? "true" : "false");
    exploreBtn.textContent = on ? "Click the map to sample (active)" : "Explore custom location";
    exploreBtn.classList.toggle("active", on);
  };
  setExploreMode(false);
  exploreBtn?.addEventListener("click", () => {
    const on = exploreBtn.getAttribute("aria-pressed") !== "true";
    setExploreUi(on);
    setExploreMode(on, (lngLat) => handleCustomClick(store, route, lngLat));
    if (!on) updateMapPanelCustom(getActiveCustom());
  });

  const stateEl = host.querySelector("[data-atf-mapstate]");
  const applyState = (ok) => {
    if (!stateEl) return;
    stateEl.dataset.ready = ok ? "1" : "0";
    stateEl.textContent = ok
      ? `Map layers installed · ${store.siteList.length} screening windows · click a marker to open Site Detail.`
      : "Map layers are waiting for the map library. The candidate list still works.";
  };
  syncMap(store, route).then((ok) => {
    applyState(ok);
    const custom = getActiveCustom();
    if (custom?.site && (customMode || sessionStorage.getItem("atf:custom-mode") === "1")) {
      showCustomLocation(custom.site.lat, custom.site.lon, { zoom: 11, fly: false });
    }
    if (!ok) setTimeout(async () => applyState(await syncMap(store, route)), 1400);
    if (route.fit === "all") setTimeout(() => fitAllSites(), 1400);
  });
  updateMapPanelCustom(getActiveCustom());
}

export function mountInspector(store, route) {
  activeStore = store;
  activeRoute = route;
  if ((document.documentElement.dataset.view || "") !== "map") return;
  const insp = document.getElementById("insp");
  if (!insp) return;

  if (customMode && sampling) return;
  const custom = getActiveCustom();
  const customModeActive = customMode || sessionStorage.getItem("atf:custom-mode") === "1";
  if (custom && customModeActive) {
    customMode = true;
    renderCustomInspector(store, route, custom);
    return;
  }

  const siteId = resolveActiveSiteId(store, route);
  const site = store.sitesById[siteId];
  if (!site) return;
  const target = store.targetsById[route.target] || store.targetList[0];
  const purpose = store.purposesById[route.purpose] || store.purposes[0];
  const score = scoreFor(store, route.target, route.purpose, site.site_id);
  if (!score) return;

  const nativeKey = `native|${site.site_id}|${route.target}|${route.purpose}|${Math.round(score.fit_score)}`;
  if (insp.dataset.atfInspectorKey === nativeKey && insp.querySelector(".fl dd strong") && !insp.querySelector(".atf-custom-insp")) {
    mountLiveOnly(insp, store, route, site, score);
    return;
  }
  insp.dataset.atfInspectorKey = nativeKey;

  updateNativeInspector(store, route, site, score, target, purpose);
  mountLiveOnly(insp, store, route, site, score);
  bindProfileCharts(insp);
}

customEvents.addEventListener("change", () => {
  if (!activeRoute) return;
  if (!getActiveCustom()) {
    customMode = false;
    sessionStorage.removeItem("atf:custom-mode");
  }
  updateMapPanelCustom(getActiveCustom());
});

document.addEventListener("click", (e) => {
  if (e.target.closest("#names button, #names .nm, #names li, [data-ident^='site:']")) {
    sessionStorage.removeItem("atf:custom-detail");
    sessionStorage.removeItem("atf:custom-mode");
    customMode = false;
  }
});

window.addEventListener("atf:catalog-site", () => {
  sessionStorage.removeItem("atf:custom-detail");
  sessionStorage.removeItem("atf:custom-mode");
  customMode = false;
});
