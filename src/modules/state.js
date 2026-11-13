/* ArtemisTwin — screening integration: data store + route reading.
   Reads only bundled static payloads. No backend, no secrets. */

const BASE = (window.__AT && window.__AT.base) || "/";
export const DATA_BASE = `${BASE.replace(/\/$/, "")}/data/`;

const FILES = [
  "model.json",
  "targets.json",
  "scores.json",
  "sites.json",
  "layers.json",
  "catalog.json",
];

async function getJSON(name) {
  const res = await fetch(`${DATA_BASE}${name}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

let storePromise = null;

export function loadStore() {
  if (!storePromise) {
    storePromise = Promise.all(FILES.map(getJSON)).then(([model, targets, scores, sites, layers, catalog]) => {
      const targetList = targets.planetary_targets || [];
      const siteList = sites.sites || [];
      const purposes = model.purposes || [];
      const targetsById = Object.fromEntries(targetList.map((t) => [t.target_id, t]));
      const purposesById = Object.fromEntries(purposes.map((p) => [p.purpose_id, p]));
      const sitesById = Object.fromEntries(siteList.map((s) => [s.site_id, s]));
      const scoresById = new Map();
      for (const [targetId, perPurpose] of Object.entries(scores)) {
        if (targetId.startsWith("_")) continue;
        for (const [purposeId, rows] of Object.entries(perPurpose || {})) {
          for (const row of rows || []) {
            scoresById.set(`${targetId}|${purposeId}|${row.site_id}`, row);
          }
        }
      }
      return {
        model,
        targets: targets,
        targetList,
        targetsById,
        purposes,
        purposesById,
        sites: sites,
        siteList,
        sitesById,
        layers: layers.layers || [],
        layersByKey: Object.fromEntries((model.layer_registry || []).map((l) => [l.layer_key, l])),
        catalog,
        scores,
        scoresById,
        generated: scores._meta?.generated || sites.generated || null,
        methodVersion: scores._meta?.methodVersion || model.method_version,
        scoreLabel: model.score_label || "Analog Fit (screening model)",
      };
    });
  }
  return storePromise;
}

export function scoreFor(store, targetId, purposeId, siteId) {
  return store.scoresById.get(`${targetId}|${purposeId}|${siteId}`) || null;
}

export function rowsFor(store, targetId, purposeId) {
  return store.scores?.[targetId]?.[purposeId] || [];
}

export function targetFor(store, route) {
  return (
    store.targetsById[route?.target] ||
    store.targetsById[store.targetList[0]?.target_id] ||
    null
  );
}

export function purposeFor(store, route) {
  return (
    store.purposesById[route?.purpose] ||
    store.purposes[0] ||
    null
  );
}

export function readRoute() {
  const live = window.__AT && window.__AT.route;
  const pathSite = decodeURIComponent((location.hash.match(/^#\/site\/([^?]+)/) || [])[1] || "");
  if (live && live.view) {
    return normalize({ ...live, site: live.site || pathSite || null });
  }

  const hash = (location.hash || "").replace(/^#/, "");
  if (!hash) return normalize({ view: "start" });
  const [path, query = ""] = hash.split("?");
  const params = new URLSearchParams(query);
  const parts = path.split("/").filter(Boolean);
  const view = parts[0] || "start";
  const route = { view, ...Object.fromEntries(params) };
  if (view === "site" && parts[1]) route.site = decodeURIComponent(parts[1]);
  if (route.p) route.portfolio = route.p.split(",").filter(Boolean);
  return normalize(route);
}

function normalize(route) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  return {
    view: route.view || "start",
    target: route.target || params.get("target") || "moon_south_pole_ridge",
    purpose: route.purpose || params.get("purpose") || "rover_mobility",
    site: route.site || params.get("site") || null,
    portfolio: route.portfolio || (route.p ? String(route.p).split(",").filter(Boolean) : []),
    at: route.at,
    fit: route.fit || params.get("fit") || new URLSearchParams(location.search).get("fit") || null,
  };
}

export function routeKey(route) {
  return [route.view, route.target, route.purpose, route.site || "", (route.portfolio || []).join(",")].join("|");
}

export function buildSiteHash(route, siteId) {
  const params = new URLSearchParams();
  if (route.target) params.set("target", route.target);
  if (route.purpose) params.set("purpose", route.purpose);
  return `#/site/${encodeURIComponent(siteId)}?${params.toString()}`;
}

export function openSite(route, siteId) {
  location.hash = buildSiteHash(route, siteId);
}

export function onChange(handler) {
  let timer = null;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(handler, 80);
  };
  addEventListener("hashchange", fire);
  addEventListener("popstate", fire);
  return fire;
}
