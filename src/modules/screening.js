/* ArtemisTwin — screening model presentation.
   Pure HTML builders; no DOM mutation outside the strings returned here. */

import {
  STATUS,
  bandText,
  esc,
  evidenceMeta,
  fmtValue,
  num,
  pct,
  shortList,
} from "./format.js";
import { liveOverrides } from "./live-apis.js";

export function siteColumn(store, key) {
  return store.model.site_columns?.[key] || null;
}

export function computeFit(store, site, target, purpose, overrides = {}) {
  const weights = purpose?.weights || {};
  let numerator = 0;
  let denominator = 0;
  let used = 0;
  let total = 0;
  const layers = [];

  for (const [key, weight] of Object.entries(weights)) {
    const spec = target?.layers?.[key];
    if (!spec) continue;
    const comparability = spec.comparability || "direct";
    if (comparability === "excluded" || comparability === "context") continue;
    total += 1;
    const col = siteColumn(store, key);
    const raw = overrides[key] !== undefined ? overrides[key] : col ? site?.[col] : null;
    const value = Number(raw);
    if (raw === null || raw === undefined || !Number.isFinite(value)) continue;
    const effective = Number(weight) * (comparability === "proxy" ? 0.5 : 1);
    if (!(effective > 0)) continue;
    const tolerance = Number(spec.tolerance);
    const s = tolerance > 0 ? Math.max(0, 1 - Math.min(1, Math.abs(value - Number(spec.target_val)) / tolerance)) : (value === Number(spec.target_val) ? 1 : 0);
    numerator += effective * s;
    denominator += effective;
    used += 1;
    layers.push({ key, value, s, effective });
  }

  return {
    score: denominator > 0 ? (numerator / denominator) * 100 : null,
    numerator,
    denominator,
    used,
    total,
    coverage: denominator > 0 ? 100 : 0,
    layers,
  };
}

function meter(score) {
  if (!score || score.fit_score === null) return "";
  const ci = score.confidence_interval || {};
  const lo = Number.isFinite(ci.ci_lower_p10) ? Math.max(0, Math.min(100, ci.ci_lower_p10)) : null;
  const hi = Number.isFinite(ci.ci_upper_p90) ? Math.max(0, Math.min(100, ci.ci_upper_p90)) : null;
  const point = Math.max(0, Math.min(100, score.fit_score));
  const bandStyle = lo !== null && hi !== null ? `left:${lo}%;width:${Math.max(1, hi - lo)}%` : "display:none";
  return `
    <div class="atf-meter" role="img" aria-label="Analog fit ${num(point, 1)} of 100${lo !== null ? `, likely range ${num(lo, 0)} to ${num(hi, 0)}` : ""}">
      <span class="atf-meter-track" aria-hidden="true"></span>
      <span class="atf-meter-band" style="${bandStyle}" aria-hidden="true"></span>
      <span class="atf-meter-mark" style="left:${point}%" aria-hidden="true"></span>
      <span class="atf-meter-scale" aria-hidden="true"><i>0</i><i>50</i><i>100</i></span>
    </div>`;
}

function evidenceChip(status) {
  const meta = evidenceMeta(status);
  return `<span class="atf-chip atf-chip-${meta.key}">${esc(meta.label)}</span>`;
}

function statusChip(status) {
  const meta = STATUS[status] || STATUS.Missing;
  return `<span class="atf-status atf-status-${meta.key}" title="${esc(meta.label)}"><i aria-hidden="true">${meta.sym}</i>${esc(meta.short)}</span>`;
}

export function scoreCard(store, route, site, score) {
  const target = store.targetsById[route.target];
  const purpose = store.purposesById[route.purpose];
  if (!site || !target || !purpose) return "";
  const hasScore = score && Number.isFinite(score.fit_score);
  const ci = score?.confidence_interval || {};
  const evidence = evidenceMeta(score?.evidence_status);
  const excluded = (score?.excluded_layers || []).map((id) => layerName(store, id));
  const missing = (score?.missing_layers || []).map((id) => layerName(store, id));

  return `
  <section class="atf-panel atf-scorecard" aria-labelledby="atfScoreH">
    <div class="atf-cardhead">
      <div>
        <p class="atf-kicker">Analog Fit · screening model</p>
        <h2 class="atf-h2" id="atfScoreH">${esc(site.site_name)}</h2>
        <p class="atf-sub">${esc(target.target_name)} · ${esc(purpose.purpose_name)}</p>
      </div>
      ${evidenceChip(score?.evidence_status)}
    </div>

    <div class="atf-scoregrid">
      <p class="atf-big">
        <b>${hasScore ? num(score.fit_score, 0) : "—"}</b><span>/100</span>
        <small>${hasScore ? bandText(score) : "Not computable"}</small>
      </p>
      <dl class="atf-facts">
        <div><dt>Likely range (p10–p90)</dt><dd>${hasScore ? `${num(ci.ci_lower_p10, 0)}–${num(ci.ci_upper_p90, 0)}` : "—"}</dd></div>
        <div><dt>Data completeness</dt><dd>${hasScore ? `${pct(score.data_completeness_pct)} · ${score.layers_present} of ${score.layers_total}` : "—"}</dd></div>
        <div><dt>Model weight covered</dt><dd>${hasScore ? pct(score.scored_weight_coverage_pct) : "—"}</dd></div>
        <div><dt>Monte Carlo draws</dt><dd>${hasScore ? num(ci.draws) : "—"}</dd></div>
      </dl>
    </div>

    ${meter(score)}

    <p class="atf-caveat"><strong>Not a match, a safety rating or a site recommendation.</strong>
      Fit is a weighted similarity between measured Earth values and a declared target envelope.
      Different envelopes or weights produce different numbers. The catalog's own Fit stays unset;
      this is a separate added screening model.</p>

    ${score?.evidence_note ? `<p class="atf-ev atf-ev-${evidence.key}">${esc(score.evidence_note)}</p>` : ""}

    ${missing.length || excluded.length ? `
      <p class="atf-gap-line"><strong>Not scored:</strong>
        ${missing.length ? `${missing.length} unmeasured condition${missing.length === 1 ? "" : "s"} (${esc(shortList(missing, 4))})` : "no unmeasured conditions"}${excluded.length ? `; Earth limit: ${esc(excluded.join(", "))}` : ""}.
      </p>` : ""}

    <p class="atf-src">Completeness counts 12 layer groups, including NASA POWER climate layers that the catalog's prepared comparison does not use. Model ${esc(store.methodVersion || "")} · site window ${esc(site.window_km)} km · ${esc(site.terrain_source || "terrain source recorded in provenance")}.</p>
  </section>`;
}

export function layerMatrix(store, route, score) {
  const target = store.targetsById[route.target];
  const purpose = store.purposesById[route.purpose];
  if (!target || !purpose) return "";
  const rows = Object.entries(target.layers)
    .map(([key, spec]) => {
      const layer = store.layersByKey[key] || {};
      const entry = score?.layer_breakdown?.[key] || {};
      const status = entry.status || (spec.comparability === "excluded" ? "Excluded" : "Missing");
      const value = entry.earth_val;
      const s = entry.s_i;
      const effective = entry.effective_weight;
      const targetText = spec.comparability === "excluded"
        ? `${fmtValue(spec.target_val, spec.unit, 2)} <em>excluded</em>`
        : `${fmtValue(spec.target_val, spec.unit, 2)} <em>± ${num(spec.tolerance, 2)} ${esc(spec.unit || "")}</em>`;
      return `
        <tr class="atf-row atf-row-${STATUS[status]?.key || "missing"}">
          <th scope="row">
            <span class="atf-lid">${esc(layer.layer_id || "")}</span>
            <span class="atf-lname">${esc(layer.layer_name || key)}</span>
            ${spec.comparability === "proxy" ? `<span class="atf-tag">proxy</span>` : ""}
          </th>
          <td class="atf-v">${value === null || value === undefined ? `<span class="atf-na">Not acquired</span>` : fmtValue(value, spec.unit, 2)}</td>
          <td class="atf-v">${targetText}</td>
          <td class="atf-si">${Number.isFinite(s) ? `<span class="atf-bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, s * 100))}%"></i></span><b>${num(s, 2)}</b>` : `<span class="atf-na">—</span>`}</td>
          <td class="atf-w">${effective ? num(effective, 2) : "0"}</td>
          <td>${statusChip(status)}</td>
        </tr>`;
    })
    .join("");

  return `
  <section class="atf-panel" aria-labelledby="atfMatrixH">
    <div class="atf-cardhead">
      <div>
        <p class="atf-kicker">Condition-by-condition</p>
        <h2 class="atf-h2 atf-h2-sm" id="atfMatrixH">Match matrix</h2>
      </div>
      <p class="atf-matrix-note">sᵢ = 1 − |Earth − target| / tolerance, floored at 0. Proxy rows carry half weight. Missing is not zero.</p>
    </div>
    <div class="atf-scroll" tabindex="0" role="region" aria-label="Condition matrix for ${esc(store.targetsById[route.target]?.target_name || "")} and ${esc(store.purposesById[route.purpose]?.purpose_name || "")}">
      <table class="atf-table">
        <caption class="vh">Earth value, target envelope, overlap score and weight for each condition</caption>
        <thead>
          <tr><th scope="col">Condition</th><th scope="col">Earth</th><th scope="col">Target envelope</th><th scope="col">Overlap</th><th scope="col">Weight</th><th scope="col">Status</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="atf-scroll-hint">On a narrow screen, scroll the table sideways to see match, weight and status.</p>
    <p class="atf-note">Weight is the effective weight for ${esc(store.purposesById[route.purpose]?.purpose_name || "this purpose")}, after the proxy multiplier. Pressure stays visible but never enters the fit.</p>
  </section>`;
}

export function gapBlock(store, route, score) {
  if (!score) return "";
  const missing = (score.missing_layers || []).map((id) => layerName(store, id));
  const excluded = (score.excluded_layers || []).map((id) => layerName(store, id));
  const sens = score.sensitivity_missing || {};
  const dominant = (score.dominant_missing || []).map((d) => `${d.label} (weight ${num(d.weight, 1)})`);
  return `
  <section class="atf-panel" aria-labelledby="atfGapH">
    <div class="atf-cardhead">
      <div>
        <p class="atf-kicker">What the score cannot see</p>
        <h2 class="atf-h2 atf-h2-sm" id="atfGapH">Gaps &amp; Earth limits</h2>
      </div>
    </div>
    ${missing.length ? `
      <h3 class="atf-h3">Unmeasured in this build</h3>
      <ul class="atf-list">${missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
      ${dominant.length ? `<p class="atf-note">High-weight gaps: ${esc(dominant.join(", "))}. The fit is computed from the conditions that remain.</p>` : ""}
      ${Number.isFinite(sens.p10) ? `<p class="atf-note"><strong>Missing-data sensitivity:</strong> ${num(sens.p10, 0)}–${num(sens.p90, 0)} if those conditions ranged from gap to full. This is a sensitivity check, not a confidence interval.</p>` : ""}
    ` : `<p class="atf-note">All 12 layer groups have an Earth value for this window.</p>`}
    ${excluded.length ? `
      <h3 class="atf-h3">Reported but excluded from the fit</h3>
      <p class="atf-note">${esc(excluded.join(", "))}: measured at the site, but no Earth surface site can reproduce the target condition. Keeping it out avoids pretending a 101 kPa site resembles a vacuum.</p>
    ` : ""}
    <p class="atf-note">Gravity, vacuum, space radiation and true polar lighting are not scored at all. They are listed in the site's Earth-limits context and cannot be fixed by choosing a different desert.</p>
  </section>`;
}

export function overview(store, route) {
  const target = store.targetsById[route.target];
  const purpose = store.purposesById[route.purpose];
  if (!target || !purpose) return "";
  const rows = (store.scores?.[route.target]?.[route.purpose] || []).slice(0, 7);
  return `
  <section class="atf-panel atf-overview" aria-labelledby="atfOverviewH">
    <div class="atf-cardhead">
      <div>
        <p class="atf-kicker">Precomputed screening · ${esc(store.methodVersion || "")}</p>
        <h2 class="atf-h2 atf-h2-sm" id="atfOverviewH">Analog Fit across the catalog</h2>
        <p class="atf-sub">${esc(target.target_name)} · ${esc(purpose.purpose_name)}</p>
        <p class="atf-note atf-bridge-top">This is a separate, added model. The catalog review above still leaves its own Fit unset.</p>
      </div>
      <span class="atf-chip">Model order</span>
    </div>
    <div class="atf-scroll" tabindex="0" role="region" aria-label="Catalog screening table">
      <table class="atf-table">
        <thead><tr><th scope="col">Screening window</th><th scope="col">Fit</th><th scope="col">Likely</th><th scope="col">Complete</th><th scope="col">Evidence</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <th scope="row"><button type="button" class="atf-link" data-atf-open="${esc(row.site_id)}">${esc(row.site_name)}</button><small>${esc(row.country || "")}</small></th>
              <td class="atf-fit"><b>${num(row.fit_score, 0)}</b></td>
              <td>${num(row.confidence_interval?.ci_lower_p10, 0)}–${num(row.confidence_interval?.ci_upper_p90, 0)}</td>
              <td>${pct(row.data_completeness_pct)}</td>
              <td>${evidenceChip(row.evidence_status)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <p class="atf-note"><strong>Model order, not a recommendation.</strong> Rows with thin evidence are marked; a high number driven by three measured conditions is not a better site. All windows are 2 × 2 km samples, not whole regions.</p>
    <p class="atf-note atf-bridge"><strong>This is an added provisional model.</strong> The catalog review above deliberately leaves its own Fit unset and its prepared evidence unchanged. These screening numbers are a separate, model-dependent exercise; they do not certify a site or overturn that review.</p>
    <p class="atf-src">Generated ${esc(store.generated || "unknown")} · ${store.siteList.length} windows · ${store.targetList.length} targets · ${store.purposes.length} purposes.</p>
  </section>`;
}

export function inspectorCard(store, route, site, score) {
  const target = store.targetsById[route.target];
  const purpose = store.purposesById[route.purpose];
  if (!site || !target || !purpose) return "";
  const has = score && Number.isFinite(score.fit_score);
  const missing = (score?.missing_layers || []).map((id) => layerName(store, id));
  return `
  <div class="atf-insp" data-atf-insp>
    <div class="atf-insp-top">
      <p class="atf-kicker">Analog Fit</p>
      ${evidenceChip(score?.evidence_status)}
    </div>
    <p class="atf-insp-score">
      <b>${has ? num(score.fit_score, 0) : "—"}</b><span>/100 · ${has ? bandText(score) : "not computable"}</span>
    </p>
    <p class="atf-insp-meta">${has ? `${pct(score.data_completeness_pct)} complete · ${score.layers_present} of ${score.layers_total} layers` : "No model result"}</p>
    <p class="atf-insp-t">${esc(target.target_name)} · ${esc(purpose.purpose_name)}</p>
    ${missing.length ? `<p class="atf-insp-g">Gaps: ${esc(shortList(missing, 3))}</p>` : ""}
    <p class="atf-insp-c">Screening similarity, not a match or safety rating.</p>
    <div class="atf-live atf-live-compact" data-atf-live data-site="${esc(site.site_id)}">
      <p class="atf-live-k"><span class="atf-dot" aria-hidden="true"></span> Live NASA context</p>
      <p class="atf-live-line" data-live-power role="status">Fetching NASA POWER…</p>
      <p class="atf-live-line" data-live-eonet>Checking NASA EONET…</p>
    </div>
  </div>`;
}

export function liveBlock(site) {
  return `
  <section class="atf-panel atf-live-panel" aria-labelledby="atfLiveH">
    <div class="atf-cardhead">
      <div>
        <p class="atf-kicker"><span class="atf-dot" aria-hidden="true"></span> Live NASA feeds</p>
        <h2 class="atf-h2 atf-h2-sm" id="atfLiveH">Current context for this window</h2>
      </div>
      <button type="button" class="atf-btn" data-atf-live-refresh>Refresh</button>
    </div>
    <div class="atf-live" data-atf-live data-site="${esc(site.site_id)}">
      <p class="atf-live-line" data-live-power role="status">Fetching NASA POWER monthly climatology…</p>
      <p class="atf-live-line" data-live-eonet>Checking NASA EONET open events within 300 km…</p>
    </div>
    <p class="atf-note">POWER and EONET are public, keyless feeds. They refresh this context panel; the cached Analog Fit is not silently overwritten. A recompute appears only when live values are available, and it is labelled as such.</p>
  </section>`;
}

export function renderLive(container, context, store, site, target, purpose, score) {
  if (!container || !container.isConnected) return;
  const powerEl = container.querySelector("[data-live-power]");
  const eonetEl = container.querySelector("[data-live-eonet]");
  const power = context.power;
  const eonet = context.eonet;

  if (powerEl) {
    if (power?.ok) {
      const v = power.values || {};
      const fit = computeFit(store, site, target, purpose, liveOverrides(power));
      const cached = Number(score?.fit_score);
      const delta = Number.isFinite(cached) && fit.score !== null ? fit.score - cached : null;
      powerEl.innerHTML = `
        <strong>NASA POWER</strong> · surface skin ${num(v.tsMin, 1)}–${num(v.tsMax, 1)} °C ·
        solar ${num(v.solar, 0)} W/m² · pressure ${num(v.pressure, 1)} kPa · AOD ${num(v.aod, 2)}
        <small>${esc(power.source)} · ${esc(power.period || "")} · fetched ${esc(new Date(power.retrieved).toLocaleTimeString())} ${power.cached ? "(cached)" : ""}</small>
        ${fit.score !== null ? `<span class="atf-recompute">Live recompute <b>${num(fit.score, 0)}</b>${delta !== null ? ` · cached ${num(cached, 0)} · Δ ${delta > 0 ? "+" : ""}${num(delta, 0)}` : ""}</span>` : ""}`;
    } else {
      powerEl.innerHTML = `<strong>NASA POWER</strong> unavailable (${esc(power?.error || "network")}). The cached climatology in the model is unchanged.`;
    }
  }

  if (eonetEl) {
    if (eonet?.ok) {
      const nearby = eonet.nearby || [];
      if (nearby.length) {
        eonetEl.innerHTML = `
          <strong>NASA EONET</strong> · ${nearby.length} open event${nearby.length === 1 ? "" : "s"} within ${eonet.radiusKm} km
          <ul class="atf-hazards">${nearby.slice(0, 3).map((ev) => `
            <li><a href="${esc(ev.url)}" rel="noopener" target="_blank">${esc(ev.title)}</a>
              <small>${esc(ev.category)} · ${num(ev.distanceKm, 0)} km${ev.date ? ` · ${esc(String(ev.date).slice(0, 10))}` : ""}</small></li>`).join("")}</ul>
          <small>Scanned ${num(eonet.total)} open events · fetched ${esc(new Date(eonet.retrieved).toLocaleTimeString())}</small>`;
      } else {
        eonetEl.innerHTML = `<strong>NASA EONET</strong> · no open events within ${eonet.radiusKm} km <small>(${num(eonet.total)} open events scanned)</small>`;
      }
      eonetEl.insertAdjacentHTML("beforeend", `<p class="atf-note">Hazard context only — wildfires, storms or volcanic activity near a window do not make it unsafe or unsuitable for analog work.</p>`);
    } else {
      eonetEl.innerHTML = `<strong>NASA EONET</strong> feed unavailable (${esc(eonet?.error || "network")}).`;
    }
  }

  const stamp = container.querySelector("[data-live-stamp]");
  if (stamp) stamp.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

export function layerName(store, layerId) {
  const found = store.layers.find((l) => l.layer_id === layerId);
  return found ? found.layer_name : layerId;
}
