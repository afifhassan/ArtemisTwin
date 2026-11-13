/* ArtemisTwin — Twin Viewer integration.
   Adds a measured E–W terrain briefing for the selected 2 km window. It does not
   modify the existing paired-profile charts. */

import { routeKey } from "./state.js";
import { esc, num } from "./format.js";
import { ensureHost } from "./dom.js";

const HOST_ID = "atf-viewer-host";

function profileSvg(profile, label) {
  if (!Array.isArray(profile) || profile.length < 3) return "";
  const W = 680;
  const H = 150;
  const padX = 12;
  const padY = 18;
  const values = profile.map(Number).filter(Number.isFinite);
  if (values.length < 3) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const x = (i) => padX + (i / (values.length - 1)) * (W - padX * 2);
  const y = (v) => padY + (1 - (v - min) / span) * (H - padY * 2);
  const pts = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  const area = `M ${x(0).toFixed(2)} ${H - padY} L ${pts.join(" L ")} L ${x(values.length - 1).toFixed(2)} ${H - padY} Z`;
  return `
    <svg class="atf-profile" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}: elevation ranges from ${num(min, 0)} to ${num(max, 0)} metres over two kilometres east to west">
      <path d="${area}" class="atf-profile-fill"></path>
      <polyline points="${pts.join(" ")}" class="atf-profile-line"></polyline>
      <line x1="${padX}" y1="${H - padY}" x2="${W - padX}" y2="${H - padY}" class="atf-profile-axis"></line>
      <text x="${padX}" y="12" class="atf-profile-text">${num(max, 0)} m</text>
      <text x="${padX}" y="${H - 4}" class="atf-profile-text">${num(min, 0)} m</text>
      <text x="${W - padX}" y="${H - 4}" text-anchor="end" class="atf-profile-text">east</text>
      <text x="${padX + 44}" y="${H - 4}" class="atf-profile-text">west</text>
    </svg>`;
}

export function mountViewer(store, route) {
  const body = document.getElementById("viewerBody");
  if (!body) return;
  const site = store.sitesById[route.site];
  if (!site) return;

  const key = routeKey(route);
  let host = body.querySelector(`#${HOST_ID}`);
  if (host && host.isConnected && host.dataset.key === key) return;
  host = ensureHost(body, HOST_ID);
  const top = body.querySelector(".pf-top");
  if (top && top.nextSibling !== host) top.insertAdjacentElement("afterend", host);
  host.dataset.key = key;

  const profile = site.profile_ew_m || [];
  host.innerHTML = `
  <section class="atf-panel" aria-labelledby="atfViewH">
    <div class="atf-cardhead">
      <div>
        <p class="atf-kicker">Measured terrain · 2 km window</p>
        <h2 class="atf-h2 atf-h2-sm" id="atfViewH">${esc(site.site_name)} · E–W profile</h2>
        <p class="atf-sub">${esc(site.window_label || "2 × 2 km screening window")}</p>
      </div>
      <span class="atf-chip">Measured</span>
    </div>
    ${profileSvg(profile, site.site_name) || `<p class="atf-note">No elevation profile is available for this window.</p>`}
    <dl class="atf-facts atf-facts-wide">
      <div><dt>Mean elevation</dt><dd>${num(site.L1_elevation_mean_m, 0)} m</dd></div>
      <div><dt>Local relief</dt><dd>${num(site.L1_relief_m, 0)} m</dd></div>
      <div><dt>Mean slope</dt><dd>${num(site.L2_slope_mean, 2)}°</dd></div>
      <div><dt>Slope p95</dt><dd>${num(site.L2_slope_p95, 2)}°</dd></div>
      <div><dt>Roughness (TRI)</dt><dd>${num(site.L3_roughness_mean, 2)}</dd></div>
      <div><dt>DEM cell</dt><dd>${num(site.grid_cell_m, 1)} m</dd></div>
    </dl>
    <p class="atf-note"><strong>This is terrain shape, not a traverse plan.</strong> A 10–30 m composite DEM cannot resolve wheel-scale rocks, crevasses, loose scree or permit conditions. The profile is a screen-window sample, not a surveyed route.</p>
    <p class="atf-src">${esc(site.terrain_source || "")} · ${esc(site.grid_cell_m ? `${site.grid_cell_m} m sampling` : "")}</p>
  </section>`;
}
