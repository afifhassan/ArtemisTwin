/* ArtemisTwin — screening integration: formatting helpers.
   Additive module. Does not touch the existing bundle or styles. */

export const STATUS = {
  "Strong overlap": { key: "full", sym: "✓", short: "Strong", label: "Strong overlap of values (score ≥ 0.80)" },
  "Partial overlap": { key: "partial", sym: "◐", short: "Partial", label: "Partial overlap of values" },
  Gap: { key: "gap", sym: "✕", short: "Gap", label: "Gap — values are far apart" },
  Missing: { key: "missing", sym: "?", short: "Missing", label: "Missing — no Earth value" },
  Excluded: { key: "excluded", sym: "⊘", short: "Excluded", label: "Excluded — Earth limit" },
  Context: { key: "context", sym: "·", short: "Context", label: "Context only" },
};

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

export function num(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function unitLabel(unit) {
  const map = {
    "W/m^2": "W/m²",
    "VWE %": "% VWE",
    "square metres": "m²",
  };
  return map[unit] || unit || "";
}

export function fmtValue(value, unit, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "Not acquired";
  const u = unitLabel(unit);
  return `${num(value, digits)}${u ? ` ${u}` : ""}`;
}

export function fmtSigned(value, unit, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${num(value, digits)}${unit ? ` ${unitLabel(unit)}` : ""}`;
}

export function pct(value) {
  return value === null || value === undefined ? "—" : `${num(value, 0)}%`;
}

export function bandText(score) {
  const ci = score?.confidence_interval;
  if (!ci || ci.ci_lower_p10 === null) return "No band";
  return `likely ${num(ci.ci_lower_p10, 0)}–${num(ci.ci_upper_p90, 0)}`;
}

export function evidenceMeta(status) {
  if (status === "thin") {
    return { key: "thin", label: "Thin evidence" };
  }
  if (status === "partial") {
    return { key: "partial", label: "Partial weight measured" };
  }
  return { key: "ok", label: "Most weight measured" };
}

export function daysAgo(iso) {
  if (!iso) return "unknown";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "unknown";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 36) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export function shortList(items, max = 3) {
  if (!items || !items.length) return "none";
  const head = items.slice(0, max);
  return head.join(", ") + (items.length > max ? ` +${items.length - max}` : "");
}
