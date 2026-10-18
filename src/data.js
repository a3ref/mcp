// Fetches the a3ref mirror (https://a3ref.github.io) and keeps it in memory for an hour.
// Nothing is bundled: the site is updated daily from the BI Community Wiki.

export const DEFAULT_BASE = "https://a3ref.github.io/";
const TTL = 60 * 60 * 1000;
const RETRY = 5 * 60 * 1000; // after a failed refresh, keep serving the old copy this long before trying again
const TIMEOUT = 30 * 1000; // fetch has no timeout of its own: a stalled site would hang the tool call for minutes

export class Data {
  constructor({ base = process.env.A3REF_BASE_URL || DEFAULT_BASE, fetchImpl = globalThis.fetch, timeout = TIMEOUT } = {}) {
    this.base = base.endsWith("/") ? base : base + "/";
    this.fetch = fetchImpl;
    this.timeout = timeout;
    this.cache = new Map();
    this.pending = new Map();
  }

  async get(path, as = "json") {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    // one download per path, however many tool calls ask for it at once (the index alone is 2 MB)
    let pending = this.pending.get(path);
    if (!pending) {
      pending = this.download(path, as).finally(() => this.pending.delete(path));
      this.pending.set(path, pending);
    }
    try {
      return await pending;
    } catch (err) {
      if (!hit) throw err;
      // the site is down or slow: an older copy beats no answer
      hit.at = Date.now() - TTL + RETRY;
      return hit.value;
    }
  }

  async download(path, as) {
    const url = this.base + path;
    let value;
    try {
      const res = await this.fetch(url, { signal: AbortSignal.timeout(this.timeout) });
      if (!res.ok) {
        const err = new Error(`${url}: HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      value = as === "json" ? await res.json() : await res.text();
    } catch (err) {
      if (err.status) throw err;
      const why = err.name === "TimeoutError" ? `no answer in ${this.timeout / 1000} s` : err.cause?.code || err.cause?.message || err.message;
      throw new Error(`Cannot reach ${url} (${why}). Check the network connection and try again; A3REF_BASE_URL overrides the site.`);
    }
    this.cache.set(path, { value, at: Date.now() });
    return value;
  }

  /** index.json items plus lookup tables, built once per download. */
  async index() {
    const raw = await this.get("index.json");
    if (this._indexFor === raw) return this._index;
    const byKey = new Map(); // key -> entries, best match first
    const add = (key, entry) => {
      const k = normalise(key);
      if (!k) return;
      const list = byKey.get(k) || byKey.set(k, []).get(k);
      if (!list.includes(entry)) list.push(entry);
    };
    // Exact names go in before any other spelling, so an alias never hides the page of that name
    // ("west" is also an alias of blufor, "setDammage" of setDamage).
    for (const e of raw.items) add(e.name, e);
    for (const e of raw.items) if (e.operator) add(e.operator, e);
    for (const e of raw.items) add(e.md.replace(/^.*\//, "").replace(/\.md$/, ""), e); // path stem, e.g. a_~21~3D_b
    for (const e of raw.items) for (const a of e.aliases || []) add(a, e);
    for (const e of raw.items) if (e.type === "topic") add(e.name.replace(/^Arma 3: /, ""), e);
    this._indexFor = raw;
    this._index = { items: raw.items, updated: raw.updated, byKey };
    return this._index;
  }

  /** Every entry a name can mean, best match first: "Position" is both a command and a topic. */
  async lookup(name, type) {
    const { byKey } = await this.index();
    const k = normalise(name);
    // "spawnGroup" for BIS_fnc_spawnGroup
    const all = byKey.get(k) || byKey.get("bis_fnc_" + k) || [];
    return type ? all.filter((e) => e.type === type) : all;
  }

  /** Find an entry by any spelling: case, spaces/underscores, operator symbol, wiki alias. */
  async find(name, type) {
    return (await this.lookup(name, type))[0] || null;
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

  /** Event handler names by kind (object, mp, mission, music, ui), read from the headings of the event handler pages. */
  async events() {
    const page = async (name) => {
      const e = await this.find(name, "topic");
      return e ? this.get(e.json) : { sections: [] };
    };
    const [object, mission, ui] = await Promise.all([
      page("Arma 3: Event Handlers"),
      page("Arma 3: Mission Event Handlers"),
      page("User Interface Event Handlers"),
    ]);
    return eventNames(object, mission, ui);
  }
}

// "Deleted (Entity) (Arma 3 v1.68)" -> "Deleted"
const headingName = (s) => (s.heading || "").match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];

export function eventNames(object, mission, ui) {
  const kinds = { object: new Map(), mp: new Map(), mission: new Map(), music: new Map(), ui: new Map() };
  const add = (kind, name) => name && kinds[kind].set(name.toLowerCase(), name);
  // The object page also lists multiplayer, music and user action events under their own level-3 headings;
  // user action events take the names of input actions, which the page does not list.
  let kind = null;
  for (const s of object.sections || []) {
    if (s.level <= 3) {
      const h = (s.heading || "").toLowerCase();
      kind = h.startsWith("multiplayer") ? "mp" : h.startsWith("music") ? "music" : h.startsWith("useraction") ? null : "object";
    } else if (kind) add(kind, headingName(s));
  }
  for (const s of mission.sections || []) if (s.level >= 4) add("mission", headingName(s));
  // listed as config attributes ("onButtonClick"); scripts add them without the prefix
  for (const s of ui.sections || []) if (s.level >= 5) add("ui", headingName(s)?.replace(/^on(?=[A-Z])/, ""));
  return kinds;
}

export function normalise(name) {
  return String(name || "")
    .trim()
    .replace(/\(\s*\)$/, "") // "createVehicle()"
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/ /g, "_");
}
