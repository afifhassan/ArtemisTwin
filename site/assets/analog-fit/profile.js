/* ArtemisTwin — interactive elevation transect.
   Renders and binds a keyboard/hover-inspectable SVG profile. */

import { num } from "./format.js";

function escapeAttr(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

export function renderProfileChart(site, { compact = false, title = "Elevation transect (W → E, 2 km)" } = {}) {
  const profile = Array.isArray(site?.profile_ew_m) ? site.profile_ew_m.map(Number).filter(Number.isFinite) : [];
  if (profile.length < 3) {
    return `<div class="atf-profile-empty">No elevation transect is available for this window.</div>`;
  }
  const width = compact ? 420 : 720;
  const height = compact ? 150 : 210;
  const padL = 42;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const profileMin = Math.min(...profile);
  const profileMax = Math.max(...profile);
  const min = Number.isFinite(Number(site?.L1_elevation_min_m)) ? Number(site.L1_elevation_min_m) : profileMin;
  const max = Number.isFinite(Number(site?.L1_elevation_max_m)) ? Number(site.L1_elevation_max_m) : profileMax;
  const span = Math.max(1, max - min);
  const x = (i) => padL + (i / (profile.length - 1)) * plotW;
  const y = (v) => padT + (1 - (v - min) / span) * plotH;
  const pts = profile.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = `M ${padL} ${padT + plotH} L ${pts.join(" L ")} L ${padL + plotW} ${padT + plotH} Z`;
  const step = Number(site.profile_step_m) || 2000 / (profile.length - 1);
  const values = profile.map((v) => v.toFixed(1)).join(",");
  const ticks = [min, min + span / 2, max];
  const lineY = compact ? 1 : 3;

  return `
  <div class="atf-profile-chart${compact ? " atf-profile-compact" : ""}">
    <div class="atf-profile-head">
      <strong>${escapeAttr(title)}</strong>
      <span>${profile.length} points · ${num(step, 1)} m step</span>
    </div>
    <svg class="atf-profile-svg" viewBox="0 0 ${width} ${height}" role="img" tabindex="0"
      aria-label="${escapeAttr(site.site_name || "Window")} elevation transect: ${num(min, 0)} to ${num(max, 0)} metres over two kilometres west to east"
      data-atf-profile data-values="${escapeAttr(values)}" data-step="${escapeAttr(step)}"
      data-width="${width}" data-height="${height}" data-min="${min}" data-max="${max}">
      <defs>
        <linearGradient id="atf-profile-fill-${escapeAttr(site.site_id || "x")}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#FFD21F" stop-opacity=".38"></stop>
          <stop offset="100%" stop-color="#FFD21F" stop-opacity=".02"></stop>
        </linearGradient>
      </defs>
      ${ticks.map((v) => `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${padL + plotW}" y2="${y(v).toFixed(1)}" class="atf-profile-grid"></line>`).join("")}
      ${ticks.map((v) => `<text x="4" y="${(y(v) + 3).toFixed(1)}" class="atf-profile-ylabel">${num(v, 0)}</text>`).join("")}
      <path d="${area}" fill="url(#atf-profile-fill-${escapeAttr(site.site_id || "x")})"></path>
      <polyline points="${pts.join(" ")}" class="atf-profile-line" fill="none"></polyline>
      <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" class="atf-profile-axis"></line>
      <line class="atf-profile-cross" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" hidden></line>
      <circle class="atf-profile-dot" r="4" cx="${padL}" cy="${padT + plotH}" hidden></circle>
      <text x="${padL}" y="${height - 6}" class="atf-profile-xlabel">west · 0 m</text>
      <text x="${padL + plotW}" y="${height - 6}" text-anchor="end" class="atf-profile-xlabel">${num((profile.length - 1) * step, 0)} m · east</text>
    </svg>
    <p class="atf-profile-readout" data-atf-readout>Move across the chart or use arrow keys to inspect elevation.</p>
    <div class="atf-profile-facts">
      <span>Relief <b>${num(site.L1_relief_m ?? max - min, 1)} m</b></span>
      <span>Min <b>${num(min, 1)} m</b></span>
      <span>Max <b>${num(max, 1)} m</b></span>
    </div>
  </div>`;
}

export function bindProfileCharts(root = document) {
  root.querySelectorAll("[data-atf-profile]").forEach((svg) => {
    if (svg.dataset.atfBound === "1") return;
    svg.dataset.atfBound = "1";
    const values = String(svg.dataset.values || "")
      .split(",")
      .map(Number)
      .filter(Number.isFinite);
    if (!values.length) return;
    const step = Number(svg.dataset.step) || 0;
    const width = Number(svg.dataset.width) || 720;
    const height = Number(svg.dataset.height) || 210;
    const wrap = svg.closest(".atf-profile-chart");
    const readout = wrap?.querySelector("[data-atf-readout]");
    const cross = svg.querySelector(".atf-profile-cross");
    const dot = svg.querySelector(".atf-profile-dot");
    const padL = 42;
    const plotW = width - padL - 12;
    const plotH = height - 14 - 26;
    let index = 0;

    const update = (next) => {
      index = Math.max(0, Math.min(values.length - 1, next));
      const x = padL + (index / (values.length - 1)) * plotW;
      const value = values[index];
      if (cross) {
        cross.hidden = false;
        cross.setAttribute("x1", x.toFixed(1));
        cross.setAttribute("x2", x.toFixed(1));
      }
      if (dot) {
        dot.hidden = false;
        dot.setAttribute("cx", x.toFixed(1));
        const min = Number(svg.dataset.min) || Math.min(...values);
        const max = Number(svg.dataset.max) || Math.max(...values);
        dot.setAttribute("cy", (14 + (1 - (value - min) / Math.max(1, max - min)) * plotH).toFixed(1));
      }
      if (readout) {
        readout.textContent = `${(index * step).toFixed(0)} m east–west · elevation ${value.toFixed(1)} m`;
      }
    };

    svg.addEventListener("pointermove", (event) => {
      const rect = svg.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      update(Math.round(ratio * (values.length - 1)));
    });
    svg.addEventListener("pointerleave", () => {
      if (cross) cross.hidden = true;
      if (dot) dot.hidden = true;
      if (readout) readout.textContent = "Move across the chart or use arrow keys to inspect elevation.";
    });
    svg.addEventListener("focus", () => update(index));
    svg.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        update(index + (event.shiftKey ? 5 : 1));
      } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        update(index - (event.shiftKey ? 5 : 1));
      }
    });
  });
}
