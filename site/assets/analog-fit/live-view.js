/* ArtemisTwin — shared live-feed attachment for a mounted panel. */

import { fetchLiveContext } from "./live-apis.js";
import { renderLive } from "./screening.js";

export function attachLive(host, { store, route, site, score }) {
  const el = host?.querySelector("[data-atf-live]");
  if (!el || !site) return;
  host._atfAbort?.abort();
  const ctrl = new AbortController();
  host._atfAbort = ctrl;

  const run = async () => {
    if (!el.isConnected) return;
    const power = el.querySelector("[data-live-power]");
    const eonet = el.querySelector("[data-live-eonet]");
    if (power) power.textContent = "Fetching NASA POWER…";
    if (eonet) eonet.textContent = "Checking NASA EONET…";
    try {
      const context = await fetchLiveContext(site, { signal: ctrl.signal });
      if (ctrl.signal.aborted || !el.isConnected) return;
      renderLive(
        el,
        context,
        store,
        site,
        store.targetsById[route.target],
        store.purposesById[route.purpose],
        score
      );
    } catch (err) {
      if (ctrl.signal.aborted) return;
      if (power) power.textContent = `NASA POWER unavailable (${String(err.message || err)}).`;
      if (eonet) eonet.textContent = "NASA EONET unavailable.";
    }
  };

  host.querySelector("[data-atf-live-refresh]")?.addEventListener("click", run);
  run();
}
