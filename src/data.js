// Fetches the a3ref mirror (https://a3ref.github.io) and keeps it in memory for an hour.
// Nothing is bundled: the site is updated daily from the BI Community Wiki.

export const DEFAULT_BASE = "https://a3ref.github.io/";
const TTL = 60 * 60 * 1000;

export class Data {
  constructor({ base = process.env.A3REF_BASE_URL || DEFAULT_BASE, fetchImpl = globalThis.fetch } = {}) {
    this.base = base.endsWith("/") ? base : base + "/";
    this.fetch = fetchImpl;
    this.cache = new Map();
  }

  async get(path, as = "json") {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    const res = await this.fetch(this.base + path);
    if (!res.ok) {
      const err = new Error(`${this.base + path}: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const value = as === "json" ? await res.json() : await res.text();
    this.cache.set(path, { value, at: Date.now() });
    return value;
  }

  /** index.json items plus lookup tables, built once per download. */
  async index() {
    const raw = await this.get("index.json");
    if (this._indexFor === raw) return this._index;
    const byKey = new Map();
    const add = (key, entry) => {
      const k = normalise(key);
      if (k && !byKey.has(k)) byKey.set(k, entry);
    };
    for (const e of raw.items) {
      add(e.name, e);
      if (e.operator) add(e.operator, e);
      add(e.md.replace(/^.*\//, "").replace(/\.md$/, ""), e); // path stem, e.g. a_~21~3D_b
      for (const a of e.aliases || []) add(a, e);
    }
    for (const e of raw.items) {
      if (e.type === "topic") add(e.name.replace(/^Arma 3: /, ""), e);
    }
    this._indexFor = raw;
    this._index = { items: raw.items, updated: raw.updated, byKey };
    return this._index;
  }

  /** Find an entry by any spelling: case, spaces/underscores, operator symbol, wiki alias. */
  async find(name) {
    const { byKey } = await this.index();
    const k = normalise(name);
    // "spawnGroup" for BIS_fnc_spawnGroup
    return byKey.get(k) || byKey.get("bis_fnc_" + k) || null;
  }

  syntax() {
    return this.get("syntax.json");
  }

  page(entry, format = "markdown") {
    return format === "json" ? this.get(entry.json) : this.get(entry.md, "text");
  }

  changes() {
    return this.get("changes.json");
  }
}

export function normalise(name) {
  return String(name || "")
    .trim()
    .replace(/\(\s*\)$/, "") // "createVehicle()"
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/ /g, "_");
}
