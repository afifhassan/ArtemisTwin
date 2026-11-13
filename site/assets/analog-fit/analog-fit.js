/* ArtemisTwin — screening integration entry point.
   Connects the frontend with precomputed terrain, climate and screening data,
   ensuring inspector panels, site details, tables, and profiles are populated. */

import { loadStore, readRoute } from "./state.js";
import { mountInspector, mountMapBand, mountStart } from "./screens.js";
import { mountDetail } from "./comparison.js";
import { mountPortfolio } from "./portfolio.js";
import { mountViewer } from "./viewer.js";
import { syncMap } from "./map.js";
import { getActiveCustom } from "./custom-site.js";

const VERSION = "1.0.0-screening";
let store = null;
let scheduled = null;
let lastError = null;

function isCustomRoute(route) {
  const customFlag = sessionStorage.getItem("atf:custom-detail") === "1";
  return (
    String(route?.site || "").startsWith("custom_") ||
    (customFlag && route?.site === "mcmurdo") ||
    (customFlag && route?.view === "site")
  );
}

function enterCustomView() {
  document.documentElement.dataset.view = "site";
  document.documentElement.dataset.atfCustom = "1";
  const app = document.querySelector(".app");
  if (app) app.style.display = "none";
  document.querySelectorAll("main.view").forEach((view) => {
    view.hidden = view.id !== "vDetail";
  });
  const detail = document.getElementById("vDetail");
  if (detail) detail.hidden = false;
  document.title = "ArtemisTwin — Custom site";
}

function exitCustomView() {
  document.documentElement.dataset.atfCustom = "0";
  const app = document.querySelector(".app");
  if (app) app.style.display = "";
}

function currentView(route) {
  if (isCustomRoute(route)) return "custom";
  return document.documentElement.dataset.view || route.view || "start";
}

function mountError(error) {
  const bodies = [
    "#detailBody",
    "#portfolioBody",
    "#viewerBody",
    "#startBody",
  ];
  const host = bodies.map((sel) => document.querySelector(sel)).find((el) => el && el.offsetParent !== null);
  if (!host) return;
  let box = host.querySelector("#atf-error-host");
  if (!box) {
    box = document.createElement("div");
    box.id = "atf-error-host";
    box.className = "atf-host";
    host.appendChild(box);
  }
  box.innerHTML = `
    <section class="atf-panel" role="alert">
      <p class="atf-kicker">Screening data unavailable</p>
      <h2 class="atf-h2 atf-h2-sm">The precomputed payloads did not load</h2>
      <p class="atf-note">${String(error?.message || error || "Unknown error")}. The original ArtemisTwin screens continue to work; this is an added layer.</p>
      <button type="button" class="atf-btn" id="atf-retry">Retry</button>
    </section>`;
  box.querySelector("#atf-retry")?.addEventListener("click", () => location.reload());
}

function render() {
  const route = readRoute();
  const view = currentView(route);
  try {
    if (view === "custom") {
      enterCustomView();
      mountDetail(store, route);
    } else {
      exitCustomView();
      if (view === "start") {
        mountStart(store, route);
      } else if (view === "map") {
        mountInspector(store, route);
        mountMapBand(store, route);
        syncMap(store, route);
      } else if (view === "site") {
        mountDetail(store, route);
      } else if (view === "portfolio") {
        mountPortfolio(store, route);
      } else if (view === "viewer") {
        mountViewer(store, route);
      }
    }
    document.documentElement.dataset.atfReady = "1";
    lastError = null;
  } catch (error) {
    if (String(error) !== String(lastError)) {
      console.error("[ArtemisTwin] screening mount failed:", error);
      lastError = error;
    }
    mountError(error);
  }
}

function schedule() {
  clearTimeout(scheduled);
  scheduled = setTimeout(render, 60);
}

function observe() {
  const targets = [
    "#app",
    "#slot",
    "#insp",
    "#names",
    "#startBody",
    "#detailBody",
    "#portfolioBody",
    "#viewerBody",
    "#vStart",
    "#vDetail",
    "#vPortfolio",
    "#vViewer",
  ];
  const seen = new Set();
  const attach = () => {
    for (const selector of targets) {
      const el = document.querySelector(selector);
      if (!el || seen.has(el)) continue;
      seen.add(el);
      new MutationObserver(schedule).observe(el, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["hidden", "data-view", "aria-pressed", "aria-expanded"],
      });
    }
  };
  attach();
  setTimeout(attach, 1000);
}

function bindInteractions() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("#names button, #names .nm, #names li, [data-ident^='site:']")) {
      sessionStorage.removeItem("atf:custom-detail");
      sessionStorage.removeItem("atf:custom-mode");
    }
    const nm = e.target.closest("#names .nm, #names li, [data-ident^='site:'], .map");
    if (nm && store) {
      setTimeout(() => {
        const route = readRoute();
        mountInspector(store, route);
      }, 40);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.closest("#names") && store) {
      sessionStorage.removeItem("atf:custom-detail");
      sessionStorage.removeItem("atf:custom-mode");
      setTimeout(() => {
        const route = readRoute();
        mountInspector(store, route);
      }, 40);
    }
  });
}

async function boot() {
  try {
    store = await loadStore();
    window.__ATF = Object.assign(window.__ATF || {}, {
      version: VERSION,
      store,
      render,
      readRoute,
      model: store.model,
      scores: store.scores,
      getCustom: getActiveCustom,
    });
    observe();
    bindInteractions();
    render();
    console.info(
      `[ArtemisTwin] screening integration ${VERSION} · model ${store.methodVersion} · ${store.siteList.length} windows`
    );
  } catch (error) {
    console.error("[ArtemisTwin] screening data failed:", error);
    window.__ATF = { version: VERSION, error: String(error), render };
    mountError(error);
    document.documentElement.dataset.atfReady = "error";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
