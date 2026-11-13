/* ArtemisTwin — MapLibre augmentation: NASA GIBS live overlays + screening markers.
   Uses the map instance the existing bundle exposes as window.__AT_MAP.
   No existing layer, marker or control is removed. */

import { openSite } from "./state.js";

const SRC = "atf-sites";
const HALO = "atf-sites-halo";
const DOT = "atf-sites-dot";
const CUSTOM_SRC = "atf-custom";
const CUSTOM_BOX = "atf-custom-box";
const CUSTOM_PIN = "atf-custom-pin";
const CUSTOM_HALO = "atf-custom-halo";
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

const OVERLAYS = {
  lst: {
    id: "atf-lst",
    tiles: [`${GIBS}/MODIS_Terra_L3_Land_Surface_Temp_Daily_Day/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`],
    maxzoom: 7,
    opacity: 0.55,
    attribution: "NASA GIBS · MODIS Terra land-surface temperature (day)",
  },
  aod: {
    id: "atf-aod",
    tiles: [`${GIBS}/MODIS_Terra_Aerosol/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`],
    maxzoom: 6,
    opacity: 0.5,
    attribution: "NASA GIBS · MODIS Terra aerosol optical depth",
  },
};

const state = { sites: true, lst: false, aod: false };
let installed = false;
let mapRef = null;
let currentRoute = null;
let lastStore = null;
let waitPromise = null;
let exploreEnabled = false;
let exploreHandler = null;

function pollForMap(timeout = 30000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const map = window.__AT_MAP;
      if (map && typeof map.getSource === "function") {
        resolve(map);
        return;
      }
      if (Date.now() - started > timeout) {
        resolve(null);
        return;
      }
      setTimeout(tick, 350);
    };
    tick();
  });
}

export function waitForMap() {
  if (window.__AT_MAP && typeof window.__AT_MAP.getSource === "function") {
    return Promise.resolve(window.__AT_MAP);
  }
  if (!waitPromise) waitPromise = pollForMap();
  return waitPromise;
}

function ready(map) {
  try {
    return typeof map.isStyleLoaded === "function" ? map.isStyleLoaded() : true;
  } catch {
    return false;
  }
}

function addOverlay(map, spec) {
  if (map.getSource(spec.id)) return;
  map.addSource(spec.id, {
    type: "raster",
    tiles: spec.tiles,
    tileSize: 256,
    maxzoom: spec.maxzoom,
    attribution: spec.attribution,
  });
  map.addLayer({
    id: spec.id,
    type: "raster",
    source: spec.id,
    layout: { visibility: "none" },
    paint: { "raster-opacity": spec.opacity },
  });
}

function install(map) {
  if (installed) return;
  if (!ready(map)) {
    map.once("load", () => {
      installed = false;
      install(map);
    });
    return;
  }
  try {
    addOverlay(map, OVERLAYS.lst);
    addOverlay(map, OVERLAYS.aod);

    if (!map.getSource(SRC)) {
      map.addSource(SRC, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
    if (!map.getLayer(HALO)) {
      map.addLayer({
        id: HALO,
        type: "circle",
        source: SRC,
        paint: {
          "circle-radius": ["case", ["boolean", ["get", "selected"], false], 16, 0],
          "circle-color": "#FFD21F",
          "circle-opacity": 0.32,
        },
      });
    }
    if (!map.getLayer(DOT)) {
      map.addLayer({
        id: DOT,
        type: "circle",
        source: SRC,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 5.5, 6, 7, 10, 9],
          "circle-color": [
            "case",
            ["boolean", ["get", "selected"], false],
            "#FFD21F",
            ["boolean", ["get", "thin"], false],
            "#8E8C85",
            "#F3F2EE",
          ],
          "circle-stroke-color": "#141414",
          "circle-stroke-width": 2.5,
          "circle-opacity": 0.98,
        },
      });
    }

    if (!map.getSource(CUSTOM_SRC)) {
      map.addSource(CUSTOM_SRC, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
    if (!map.getLayer(CUSTOM_BOX)) {
      map.addLayer({
        id: CUSTOM_BOX,
        type: "line",
        source: CUSTOM_SRC,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "line-color": "#FFD21F",
          "line-width": 2,
          "line-dasharray": [2, 2],
        },
      });
    }
    if (!map.getLayer(CUSTOM_HALO)) {
      map.addLayer({
        id: CUSTOM_HALO,
        type: "circle",
        source: CUSTOM_SRC,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 18,
          "circle-color": "#FFD21F",
          "circle-opacity": 0.28,
        },
      });
    }
    if (!map.getLayer(CUSTOM_PIN)) {
      map.addLayer({
        id: CUSTOM_PIN,
        type: "circle",
        source: CUSTOM_SRC,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#FFD21F",
          "circle-stroke-color": "#141414",
          "circle-stroke-width": 2.5,
        },
      });
    }

    map.on("click", (event) => {
      if (!exploreEnabled || !exploreHandler) return;
      const onMarker = event.features?.some((f) => f.layer?.id === DOT);
      if (onMarker) return;
      exploreHandler(event.lngLat);
    });

    map.on("click", DOT, (event) => {
      const feature = event.features?.[0];
      if (feature && currentRoute) {
        window.dispatchEvent(new CustomEvent("atf:catalog-site", { detail: { siteId: feature.properties.site_id } }));
        openSite(currentRoute, feature.properties.site_id);
      }
    });
    map.on("mouseenter", DOT, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", DOT, () => {
      map.getCanvas().style.cursor = "";
    });

    installed = true;
  } catch (err) {
    installed = false;
    // A later route change retries; never throw into the host app.
    console.warn("[ArtemisTwin] map layer install deferred:", err);
  }
}

function applyVisibility() {
  if (!mapRef) return;
  const toggle = (id, on) => {
    if (mapRef.getLayer(id)) {
      mapRef.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    }
  };
  toggle(OVERLAYS.lst.id, state.lst);
  toggle(OVERLAYS.aod.id, state.aod);
  if (mapRef.getLayer(HALO)) {
    mapRef.setLayoutProperty(HALO, "visibility", state.sites ? "visible" : "none");
  }
  if (mapRef.getLayer(DOT)) {
    mapRef.setLayoutProperty(DOT, "visibility", state.sites ? "visible" : "none");
  }
}

function featureCollection(store, route) {
  const rows = store.scores?.[route.target]?.[route.purpose] || [];
  const byId = new Map(rows.map((row) => [row.site_id, row]));
  return {
    type: "FeatureCollection",
    features: store.siteList.map((site) => {
      const row = byId.get(site.site_id);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [site.lon, site.lat] },
        properties: {
          site_id: site.site_id,
          name: site.site_name,
          fit: Number.isFinite(row?.fit_score) ? Math.round(row.fit_score) : null,
          completeness: row?.data_completeness_pct ?? null,
          thin: row?.evidence_status === "thin",
          selected: site.site_id === route.site,
        },
      };
    }),
  };
}

function updateData(map, store, route) {
  const source = map.getSource(SRC);
  if (!source) return;
  source.setData(featureCollection(store, route));
  map.triggerRepaint();
}

export async function syncMap(store, route) {
  currentRoute = route;
  lastStore = store;
  const map = await waitForMap();
  if (!map) return false;
  mapRef = map;
  install(map);
  if (installed) {
    updateData(map, store, route);
    applyVisibility();
  }
  return installed;
}

export async function fitAllSites() {
  const map = await waitForMap();
  if (!map || !lastStore?.siteList?.length) return false;
  // The seven windows span the Arctic, Antarctica, Hawaii, Chile and Spain, so
  // an explicit world view is more reliable than fitBounds across the
  // antimeridian, which the host app may immediately re-frame.
  map.jumpTo({ center: [3.5, 4], zoom: 0, bearing: 0, pitch: 0 });
  return true;
}

export function setOverlay(layer, on) {
  if (layer in state) state[layer] = Boolean(on);
  applyVisibility();
}

export function setSitesVisible(on) {
  state.sites = Boolean(on);
  applyVisibility();
}

export function mapLayerState() {
  return { ...state };
}

export function setExploreMode(enabled, handler = null) {
  exploreEnabled = Boolean(enabled);
  exploreHandler = handler || exploreHandler;
  if (mapRef) mapRef.getCanvas().style.cursor = exploreEnabled ? "crosshair" : "";
}

export async function showCustomLocation(lat, lon, { zoom = 11, fly = true } = {}) {
  const map = await waitForMap();
  if (!map) return false;
  const source = map.getSource(CUSTOM_SRC);
  if (!source) return false;
  const dlat = 1 / 110.574;
  const dlon = 1 / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const ring = [
    [lon - dlon, lat - dlat],
    [lon + dlon, lat - dlat],
    [lon + dlon, lat + dlat],
    [lon - dlon, lat + dlat],
    [lon - dlon, lat - dlat],
  ];
  source.setData({
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: { kind: "pin" } },
      { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { kind: "window" } },
    ],
  });
  for (const id of [CUSTOM_BOX, CUSTOM_HALO, CUSTOM_PIN]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
  }
  if (fly) map.jumpTo({ center: [lon, lat], zoom, bearing: 0, pitch: 0 });
  map.triggerRepaint();
  return true;
}

export async function clearCustomLocation() {
  const map = await waitForMap();
  if (!map) return;
  const source = map.getSource(CUSTOM_SRC);
  if (source) source.setData({ type: "FeatureCollection", features: [] });
  setExploreMode(false);
}
