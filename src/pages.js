// Shapes reference pages for `get`: sections of topic pages, and an outline instead of very long pages.

export const OUTLINE_OVER = 40000; // characters (~10k tokens): Event Handlers alone is 108k

const nameOf = (heading) => (heading || "").replace(/\s*\(.*$/, "").toLowerCase(); // "Fired (Arma 3 v1.00)" -> "fired"

/**
 * Sections whose heading matches `want`, each with its subsections. An exact heading wins over partial matches,
 * so "Fired" returns Fired, not also FiredMan, FiredNear and ArtilleryShellFired.
 */
export function pickSections(sections, want) {
  const w = want.trim().toLowerCase();
  const exact = sections.filter((s) => s.heading && (s.heading.toLowerCase() === w || nameOf(s.heading) === w));
  const chosen = new Set(exact.length ? exact : sections.filter((s) => (s.heading || "").toLowerCase().includes(w)));
  const out = [];
  let under = null; // level of the chosen section whose subsections are being taken
  for (const s of sections) {
    if (under !== null && s.level > under) out.push(s);
    else if (chosen.has(s)) {
      out.push(s);
      under = s.level;
    } else under = null;
  }
  return out;
}

export function renderSections(sections) {
  return sections.map((s) => `${"#".repeat(s.level)} ${s.heading}\n\n${s.markdown}`.trim()).join("\n\n");
}

/** Headings of a long page, indented by level, plus its untitled introduction. */
export function outline(entry, page, url) {
  const titled = page.sections.filter((s) => s.heading);
  const top = Math.min(...titled.map((s) => s.level));
  const list = titled.map((s) => `${"  ".repeat(s.level - top)}- ${s.heading}`).join("\n");
  const intro = page.sections[0] && !page.sections[0].heading ? page.sections[0].markdown.trim() : "";
  const example = titled.find((s) => s.level === Math.max(...titled.map((t) => t.level)))?.heading.replace(/\s*\(.*$/, "");
  return [
    `# ${entry.name}`,
    intro,
    `This page is long, so only its outline is shown. Call get again with \`section\` set to a heading` +
      (example ? ` (e.g. "${example}")` : "") + ` to read that part with its subsections.`,
    list,
    `Whole page: ${url}`,
  ].filter(Boolean).join("\n\n");
}
