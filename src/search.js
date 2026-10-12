// Ranks index.json entries for a free-text query: exact names first, then prefixes, then entries whose
// name, summary, groups and syntax contain the query words, with rare words weighing more than common ones
// ("attach object to vehicle": "attach" decides, "vehicle" appears on hundreds of pages).

const STATUS_PENALTY = 120; // deprecated and broken entries sink below working alternatives
const STOP = new Set(["a", "an", "the", "to", "of", "on", "in", "for", "with", "and", "or", "is", "it", "how", "do", "get", "by"]);

export function search(items, query, { type = "any", limit = 10 } = {}) {
  const q = String(query).trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/[^a-z0-9_#!=<>&|+\-*/%^:]+/).filter((w) => w.length >= 2 && !STOP.has(w));
  const weight = idf(items, words);
  const scored = [];
  for (const e of items) {
    if (type !== "any" && e.type !== type) continue;
    const s = score(e, q, words, weight);
    if (s > 0) scored.push([s - (e.status && e.status !== "ok" ? STATUS_PENALTY : 0), e]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].name.length - b[1].name.length);
  return scored.slice(0, limit).map(([, e]) => e);
}

function idf(items, words) {
  const out = {};
  for (const w of words) {
    let df = 0;
    for (const e of items) if (e.name.toLowerCase().includes(w) || (e.summary || "").toLowerCase().includes(w)) df++;
    out[w] = Math.log((items.length + 1) / (df + 1)) + 0.5;
  }
  return out;
}

function score(e, q, words, weight) {
  const n = e.name.toLowerCase();
  const short = n.replace(/^[a-z0-9]+_fnc_/, "");
  const op = (e.operator || "").toLowerCase();
  if (n === q || op === q || short === q) return 1000;
  const joined = q.replace(/\s+/g, "");
  if (joined !== q && (n === joined || short === joined)) return 990; // "delete vehicle" -> deleteVehicle
  if ((e.aliases || []).some((a) => a.toLowerCase() === q)) return 950;
  if (n.startsWith(q)) return 800 - (n.length - q.length);
  if (short.startsWith(q)) return 760 - (short.length - q.length);
  if (n.includes(q)) return 600 - n.indexOf(q);

  if (!words.length) return 0;
  const summary = (e.summary || "").toLowerCase();
  const groups = (e.groups || []).join(" ").toLowerCase();
  const syntax = (e.syntax || []).join(" ").toLowerCase();
  let total = 0;
  let matched = 0;
  for (const w of words) {
    let s = 0;
    if (n.startsWith(w) || short.startsWith(w)) s += 12;
    else if (n.includes(w)) s += 7;
    if (summary.match(new RegExp(`\\b${escape(w)}`))) s += 5;
    if (groups.includes(w)) s += 3;
    if (syntax.includes(w)) s += 2;
    if (s) matched += 1;
    total += s * weight[w];
  }
  if (matched < Math.ceil(words.length / 2)) return 0;
  return total + (matched === words.length ? 5 : 0);
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
