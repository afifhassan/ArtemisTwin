/* ArtemisTwin — Portfolio & Gaps integration.
   Adds a screening coverage table and a union-of-gaps view beneath the
   existing portfolio UI. It never changes the app's own portfolio state. */

import { openSite, routeKey, scoreFor } from "./state.js";
import { bandText, esc, evidenceMeta, num, pct } from "./format.js";
import { bindOpenButtons, ensureHost } from "./dom.js";

const HOST_ID = "atf-portfolio-host";

export function mountPortfolio(store, route) {
  const body = document.getElementById("portfolioBody");
  if (!body) return;
  const key = routeKey(route);
  let host = body.querySelector(`#${HOST_ID}`);
  if (host && host.isConnected && host.dataset.key === key) return;

  host = ensureHost(body, HOST_ID);
  const top = body.querySelector(".pf-top");
  if (top && top.nextSibling !== host) top.insertAdjacentElement("afterend", host);
  host.dataset.key = key;

  const ids = (route.portfolio || []).filter((id) => store.sitesById[id]);
  const target = store.targetsById[route.target];
  const purpose = store.purposesById[route.purpose];

  if (!ids.length) {
    host.innerHTML = `
      <section class="atf-panel" aria-labelledby="atfPfH">
        <div class="atf-cardhead">
          <div>
            <p class="atf-kicker">Portfolio screening</p>
            <h2 class="atf-h2 atf-h2-sm" id="atfPfH">No windows selected yet</h2>
          </div>
          <span class="atf-chip">Empty portfolio</span>
        </div>
        <p class="atf-note">Add one or more catalog sites above. This panel then shows the modelled fit for each window, which conditions are covered, and which 12-layer conditions are still missing across the whole portfolio.</p>
        <p class="atf-note"><strong>Portfolio totals are counts, not a combined mission score.</strong> Fit values are not additive and no portfolio is ranked.</p>
      </section>`;
    return;
  }

  const rows = ids.map((id) => {
    const site = store.sitesById[id];
    const score = scoreFor(store, route.target, route.purpose, id);
    return { site, score };
  });

  const completeness = rows.filter((r) => r.score).map((r) => r.score.data_completeness_pct);
  const avgComplete = completeness.length ? completeness.reduce((a, b) => a + b, 0) / completeness.length : null;
  const thin = rows.filter((r) => r.score?.evidence_status === "thin").length;

  const gapCount = new Map();
  for (const { score } of rows) {
    for (const id of score?.missing_layers || []) {
      gapCount.set(id, (gapCount.get(id) || 0) + 1);
    }
  }
  const gapRows = [...gapCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => {
      const layer = store.layers.find((l) => l.layer_id === id);
      return `<li><b>${esc(layer?.layer_name || id)}</b> <span>${count} of ${rows.length} windows</span></li>`;
    });

  host.innerHTML = `
  <section class="atf-panel" aria-labelledby="atfPfH">
    <div class="atf-cardhead">
      <div>
        <p class="atf-kicker">Portfolio screening · ${esc(store.methodVersion || "")}</p>
        <h2 class="atf-h2 atf-h2-sm" id="atfPfH">Coverage across ${rows.length} window${rows.length === 1 ? "" : "s"}</h2>
        <p class="atf-sub">${esc(target?.target_name || route.target)} · ${esc(purpose?.purpose_name || route.purpose)}</p>
      </div>
      <span class="atf-chip">Counts, not a ranking</span>
    </div>

    <dl class="atf-tiles">
      <div><dt>Windows</dt><dd>${rows.length}</dd></div>
      <div><dt>Mean completeness</dt><dd>${pct(avgComplete)}</dd></div>
      <div><dt>Thin evidence</dt><dd>${thin}</dd></div>
      <div><dt>Distinct gaps</dt><dd>${gapCount.size}</dd></div>
    </dl>

    <div class="atf-scroll" tabindex="0" role="region" aria-label="Portfolio screening table">
      <table class="atf-table">
        <thead><tr><th scope="col">Window</th><th scope="col">Fit</th><th scope="col">Likely</th><th scope="col">Complete</th><th scope="col">Evidence</th><th scope="col">Gaps</th></tr></thead>
        <tbody>
          ${rows.map(({ site, score }) => {
            const evidence = evidenceMeta(score?.evidence_status);
            return `<tr>
              <th scope="row"><button type="button" class="atf-link" data-atf-open="${esc(site.site_id)}">${esc(site.site_name)}</button><small>${esc(site.country || "")}</small></th>
              <td class="atf-fit"><b>${Number.isFinite(score?.fit_score) ? num(score.fit_score, 0) : "—"}</b></td>
              <td>${score ? bandText(score) : "—"}</td>
              <td>${pct(score?.data_completeness_pct)}</td>
              <td><span class="atf-chip atf-chip-${evidence.key}">${esc(evidence.label)}</span></td>
              <td>${(score?.missing_layers || []).length}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>

    <h3 class="atf-h3">Gaps shared across the portfolio</h3>
    ${gapRows.length ? `<ul class="atf-list atf-gap-list">${gapRows.join("")}</ul>` : `<p class="atf-note">No missing scored layers across these windows.</p>`}
    <p class="atf-note">A condition missing from every window is a limit of this build, not a property of the sites. Ice, mineralogy, rock abundance, cave proximity and access are not acquired for any window yet.</p>
    <p class="atf-note"><strong>No combined fit is shown.</strong> Averaging across windows or adding their scores would invent a quantity the model does not support.</p>
  </section>`;

  bindOpenButtons(host, route, openSite);
}
