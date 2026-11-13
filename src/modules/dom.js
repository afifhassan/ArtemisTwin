/* ArtemisTwin — small DOM helpers shared by the additive mounts. */

export function ensureHost(parent, id, className = "atf-host") {
  if (!parent) return null;
  let host = parent.querySelector(`#${id}`);
  if (!host || !host.isConnected) {
    host = document.createElement("div");
    host.id = id;
    host.className = className;
    parent.appendChild(host);
  }
  return host;
}

export function bindOpenButtons(root, route, openSite) {
  root.querySelectorAll("[data-atf-open]").forEach((button) => {
    button.addEventListener("click", () => openSite(route, button.dataset.atfOpen));
  });
}

export function setText(el, text) {
  if (el) el.textContent = text;
}
