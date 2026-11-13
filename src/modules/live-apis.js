/* ArtemisTwin — live client APIs (NASA POWER + NASA EONET v3).
   Keyless endpoints; no credential is embedded in the static build.
   Results are cached in sessionStorage to stay polite to the public APIs. */

const POWER_BASE = "https://power.larc.nasa.gov/api/temporal";
const EONET_BASE = "https://eonet.gsfc.nasa.gov/api/v3";
const CACHE_PREFIX = "atf:live:v1:";
const POWER_TTL = 30 * 60 * 1000;
const EONET_TTL = 10 * 60 * 1000;
const HAZARD_RADIUS_KM = 300;

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.t ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), data }));
  } catch {
    /* storage may be disabled; live calls still work */
  }
}

async function getJSON(url, { signal, timeout = 22000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException("timeout", "TimeoutError")), timeout);
  const onAbort = () => ctrl.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

function valid(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > -900;
}

function mean(values) {
  const ok = values.filter(valid);
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
}

function monthValues(parameter, key) {
  const series = parameter?.[key] || {};
  const monthNames = new Set(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]);
  return Object.entries(series)
    .filter(([stamp]) => {
      if (/^\d{6}$/.test(stamp)) {
        const month = Number(stamp.slice(4));
        return month >= 1 && month <= 12;
      }
      return monthNames.has(stamp);
    })
    .map(([, value]) => Number(value))
    .filter(valid);
}

function computePower(parameter) {
  const ts = monthValues(parameter, "TS");
  const solar = monthValues(parameter, "ALLSKY_SFC_SW_DWN");
  const pressure = monthValues(parameter, "PS");
  const aod = monthValues(parameter, "AOD_55");
  const wind = monthValues(parameter, "WS2M");
  const solarKwh = mean(solar);
  const aodMean = mean(aod);
  return {
    tsMax: ts.length ? Math.max(...ts) : null,
    tsMin: ts.length ? Math.min(...ts) : null,
    tsMean: mean(ts),
    solar: solarKwh === null ? null : (solarKwh * 1000) / 24,
    pressure: mean(pressure),
    aod: aodMean,
    dust: aodMean === null ? null : Math.max(0, Math.min(1, aodMean / 0.8)),
    wind: mean(wind),
    months: ts.length,
  };
}

function powerUrl(lat, lon, mode, year) {
  const params = new URLSearchParams({
    parameters: "TS,PS,ALLSKY_SFC_SW_DWN,AOD_55,WS2M",
    community: "RE",
    longitude: lon.toFixed(6),
    latitude: lat.toFixed(6),
    format: "JSON",
  });
  if (mode === "monthly") {
    params.set("start", String(year));
    params.set("end", String(year));
  }
  return `${POWER_BASE}/${mode}/point?${params.toString()}`;
}

export async function fetchPower(site, { signal } = {}) {
  const year = new Date().getUTCFullYear() - 1;
  const key = `power:${site.site_id}:${year}`;
  const cached = readCache(key);
  if (cached && Date.now() - cached.t < POWER_TTL) {
    return { ...cached.data, cached: true };
  }

  try {
    const monthly = await getJSON(powerUrl(site.lat, site.lon, "monthly", year), { signal });
    const values = computePower(monthly?.properties?.parameter || {});
    if (values.months < 6) throw new Error("incomplete monthly record");
    const out = {
      ok: true,
      source: "NASA POWER monthly (MERRA-2)",
      period: String(year),
      values,
      retrieved: new Date().toISOString(),
      url: powerUrl(site.lat, site.lon, "monthly", year),
    };
    writeCache(key, out);
    return out;
  } catch (err) {
    if (cached) return { ...cached.data, cached: true, stale: true, error: String(err.message || err) };
    try {
      const clim = await getJSON(powerUrl(site.lat, site.lon, "climatology"), { signal });
      const values = computePower(clim?.properties?.parameter || {});
      const out = {
        ok: true,
        source: "NASA POWER climatology (MERRA-2), fallback",
        period: "2001–2020 normals",
        values,
        retrieved: new Date().toISOString(),
        fallback: true,
      };
      writeCache(key, out);
      return out;
    } catch (fallbackErr) {
      return {
        ok: false,
        error: String(fallbackErr.message || fallbackErr),
        retrieved: new Date().toISOString(),
      };
    }
  }
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0088;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function eventPoint(event) {
  const geometries = Array.isArray(event.geometry) ? event.geometry : [];
  for (let i = geometries.length - 1; i >= 0; i -= 1) {
    const geom = geometries[i];
    if (!geom || geom.type !== "Point" || !Array.isArray(geom.coordinates)) continue;
    const [lon, lat] = geom.coordinates;
    if (Number.isFinite(lon) && Number.isFinite(lat)) return { lat, lon, date: geom.date };
  }
  return null;
}

export async function fetchEonet(site, { signal } = {}) {
  const key = "eonet:global";
  const cached = readCache(key);
  let events;
  let retrieved;
  if (cached && Date.now() - cached.t < EONET_TTL) {
    events = cached.data.events;
    retrieved = cached.data.retrieved;
  } else {
    try {
      const payload = await getJSON(`${EONET_BASE}/events?status=open&days=30&limit=500`, { signal });
      events = Array.isArray(payload.events) ? payload.events : [];
      retrieved = new Date().toISOString();
      writeCache(key, { events, retrieved });
    } catch (err) {
      if (!cached) {
        return { ok: false, error: String(err.message || err), nearby: [], total: 0 };
      }
      events = cached.data.events;
      retrieved = cached.data.retrieved;
    }
  }

  const nearby = [];
  for (const event of events) {
    const point = eventPoint(event);
    if (!point) continue;
    const distanceKm = haversineKm(site.lat, site.lon, point.lat, point.lon);
    if (distanceKm > HAZARD_RADIUS_KM) continue;
    nearby.push({
      id: event.id,
      title: event.title,
      category: event.categories?.[0]?.title || "Uncategorised",
      date: point.date,
      distanceKm,
      url: `https://eonet.gsfc.nasa.gov/api/v3/events/${encodeURIComponent(event.id)}`,
    });
  }
  nearby.sort((a, b) => a.distanceKm - b.distanceKm);
  return {
    ok: true,
    total: events.length,
    nearby: nearby.slice(0, 6),
    nearbyCount: nearby.length,
    radiusKm: HAZARD_RADIUS_KM,
    retrieved,
    cached: Boolean(cached),
  };
}

export function liveOverrides(power) {
  if (!power?.ok) return {};
  const v = power.values || {};
  const map = {
    L4_temperature_max: v.tsMax,
    L4_temperature_min: v.tsMin,
    L5_solar_illumination: v.solar,
    L6_surface_pressure: v.pressure,
    L9_dust_hazard: v.dust,
  };
  return Object.fromEntries(Object.entries(map).filter(([, value]) => Number.isFinite(value)));
}

export async function fetchLiveContext(site, { signal } = {}) {
  const [power, eonet] = await Promise.allSettled([
    fetchPower(site, { signal }),
    fetchEonet(site, { signal }),
  ]);
  return {
    power: power.status === "fulfilled" ? power.value : { ok: false, error: String(power.reason) },
    eonet: eonet.status === "fulfilled" ? eonet.value : { ok: false, error: String(eonet.reason), nearby: [] },
  };
}
