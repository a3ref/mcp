// a3ref MCP server: the Arma 3 scripting reference (https://a3ref.github.io) as tools for AI agents.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Data } from "./data.js";
import { search } from "./search.js";
import { lint, format, closest } from "./lint.js";
import { OUTLINE_OVER, pickSections, renderSections, outline } from "./pages.js";

const VERSION = "0.2.0";
const data = new Data();

const INSTRUCTIONS = `Arma 3 scripting reference (SQF), mirrored daily from the Bohemia Interactive Community Wiki.
Use it whenever you write, review or debug Arma 3 scripts, missions or mods:
- search: find commands, BIS_fnc_* functions and concept pages by name or by what they do.
- get: read one page (syntax, typed parameters, return value, locality, examples). Check status: deprecated and broken pages name a replacement.
- lint_sqf: check SQF before presenting it: catches made-up commands, wrong operand forms, unknown BIS_fnc_* functions and deprecated commands.
Do not rely on memory for SQF syntax; names are often similar and many commands are binary (left operand required).`;

const server = new McpServer({ name: "a3ref", version: VERSION }, { instructions: INSTRUCTIONS });
// All four hints are explicit: some directories (OpenAI's) reject tools that omit any of them.
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const text = (t) => ({ content: [{ type: "text", text: t }] });
const fail = (t) => ({ content: [{ type: "text", text: t }], isError: true });

function line(e) {
  const flag = e.status && e.status !== "ok" ? ` [${e.status}]` : "";
  const op = e.operator ? ` (operator ${e.operator})` : "";
  const syntax = e.syntax?.length ? `\n  syntax: ${e.syntax.slice(0, 3).join(" | ")}` : "";
  return `- ${e.name}${op} — ${e.type}${flag}: ${e.summary || "(no summary)"}${syntax}\n  ${data.base}${e.md}`;
}

server.registerTool(
  "search",
  {
    title: "Search the Arma 3 scripting reference",
    description:
      "Find Arma 3 SQF scripting commands, BIS_fnc_* functions and concept pages (data types, locality, event handlers) " +
      "by name, partial name, operator symbol or keywords describing what they do. Returns names, syntax and one-line summaries.",
    inputSchema: {
      query: z.string().min(1).describe('Name or keywords, e.g. "setPos", "spawnGroup", "attach object to vehicle", ">>"'),
      type: z.enum(["any", "command", "function", "topic"]).default("any").describe("Limit to one kind of page"),
      limit: z.number().int().min(1).max(50).default(10).describe("Maximum number of results"),
    },
    annotations: readOnly,
  },
  async ({ query, type, limit }) => {
    const { items } = await data.index();
    const hits = search(items, query, { type, limit });
    if (!hits.length) return text(`Nothing matches "${query}". Try fewer or different keywords, or part of the name.`);
    return text(`${hits.length} result${hits.length === 1 ? "" : "s"} for "${query}":\n\n${hits.map(line).join("\n")}`);
  },
);

server.registerTool(
  "get",
  {
    title: "Read a reference page",
    description:
      "Read the full page of an Arma 3 command, function or concept: description, every syntax with typed parameters " +
      "and return value, locality, examples and community notes. Names are matched case-insensitively; operators by symbol; " +
      "BIS_fnc_ may be omitted. Long concept pages (e.g. Event Handlers) return an outline: pass `section` to read a part.",
    inputSchema: {
      name: z.string().min(1).describe('e.g. "createVehicle", "BIS_fnc_spawnGroup", "!=", "Event Handlers", "Position"'),
      type: z.enum(["command", "function", "topic"]).optional()
        .describe('Only when a command and a concept page share a name: "Position", "Group", "Side"'),
      format: z.enum(["markdown", "json"]).default("markdown").describe("markdown reads best; json has structured fields"),
      section: z.string().optional().describe('Topic pages only: heading to read, with its subsections, e.g. "HandleDamage"'),
    },
    annotations: readOnly,
  },
  async ({ name, type, format, section }) => {
    const all = await data.lookup(name, type);
    // a section is asked of a concept page: "Position" with a section means the topic, not the position command
    const entry = (section && all.find((e) => e.type === "topic")) || all[0];
    if (!entry) return fail(await notFound(name, type));
    const url = data.base + entry.md;
    const others = all.filter((e) => e.type !== entry.type);
    const also = others.map((e) => `\n\nAlso a ${e.type} page named "${e.name}": call get with type "${e.type}".`).join("");
    if (section && entry.type === "topic") {
      const page = await data.page(entry, "json");
      const parts = pickSections(page.sections, section);
      if (!parts.length) {
        const headings = page.sections.map((s) => s.heading).filter(Boolean);
        return fail(`No section matching "${section}" in ${entry.name}. Sections: ${headings.join(", ")}`);
      }
      return text(`# ${entry.name}\n\n${renderSections(parts)}\n\nSource: ${url}`);
    }
    const page = await data.page(entry, format);
    if (format === "json") return text(JSON.stringify(page)); // stays parseable: no note appended
    if (entry.type === "topic" && page.length > OUTLINE_OVER) return text(outline(entry, await data.page(entry, "json"), url) + also);
    const note = section ? `\n\n(\`section\` applies to concept pages; this is the whole ${entry.type} page.)` : "";
    return text(page + note + also);
  },
);

async function notFound(name, type) {
  const { items, byKey } = await data.index();
  const ofType = type ? items.filter((e) => e.type === type) : items;
  let near = search(ofType, name, { limit: 5 });
  if (!near.length) {
    // a misspelt name ("setPoss") is no substring of anything; edit distance still finds it
    const keys = closest(name.toLowerCase().replace(/\s+/g, "_"), [...byKey.keys()], 2, 5);
    near = [...new Set(keys.flatMap((k) => byKey.get(k)))].filter((e) => !type || e.type === type).slice(0, 5);
  }
  const what = type ? `${type} page` : "page";
  return `No ${what} named "${name}".` + (near.length ? ` Closest matches:\n${near.map(line).join("\n")}` : " Try search with keywords.") +
    `\nEvent handlers and other parts of concept pages are sections: get "Event Handlers" with section "HandleDamage".`;
}

server.registerTool(
  "list_group",
  {
    title: "List a command or function group",
    description:
      "List every command or function in a group (e.g. \"Object Manipulation\", \"Multiplayer\", \"GUI Control\") with one-line " +
      "summaries. Without a group, lists all groups with their sizes.",
    inputSchema: {
      group: z.string().optional().describe('Group name, e.g. "Multiplayer"; a partial name matches. Omit to list every group'),
      type: z.enum(["command", "function", "topic"]).default("command").describe("Which kind of group"),
    },
    annotations: readOnly,
  },
  async ({ group, type }) => {
    const { items } = await data.index();
    const ofType = items.filter((e) => e.type === type);
    const counts = new Map();
    for (const e of ofType) for (const g of e.groups || []) counts.set(g, (counts.get(g) || 0) + 1);
    if (!group) {
      const groups = [...counts].sort((a, b) => a[0].localeCompare(b[0]));
      return text(`${type} groups:\n${groups.map(([g, n]) => `- ${g} (${n})`).join("\n")}`);
    }
    const want = group.toLowerCase();
    const match = [...counts.keys()].find((g) => g.toLowerCase() === want) || [...counts.keys()].find((g) => g.toLowerCase().includes(want));
    if (!match) return fail(`No ${type} group "${group}". Call list_group without a group to see them all.`);
    const members = ofType.filter((e) => e.groups?.includes(match)).sort((a, b) => a.name.localeCompare(b.name));
    return text(`${match} (${members.length} ${type}s):\n\n${members.map(line).join("\n")}`);
  },
);

server.registerTool(
  "lint_sqf",
  {
    title: "Check SQF code",
    description:
      "Statically check Arma 3 SQF code against the reference: unknown (made-up) commands, commands used in a form they do not " +
      "have (e.g. a binary command without its left operand, a command without its argument), unknown BIS_fnc_* functions, " +
      "deprecated or broken commands, diagnostic-build-only commands, format strings missing values and unknown event " +
      "handler names. Run it on SQF you wrote before presenting it. " +
      "Unknown words in variable positions are treated as global variables and are not reported.",
    inputSchema: { code: z.string().min(1).describe("SQF source code") },
    annotations: readOnly,
  },
  async ({ code }) => {
    const syntax = await data.syntax();
    // event names come from three topic pages: fetch them only for code that adds or removes handlers,
    // and lint without them if they cannot be read
    const events = /eventhandler/i.test(code) ? await data.events().catch(() => null) : null;
    return text(format(lint(code, syntax, { events }), code));
  },
);

server.registerTool(
  "recent_changes",
  {
    title: "Recent wiki edits",
    description: "Commands, functions and topics edited on the BI Community Wiki recently (newest first).",
    inputSchema: { limit: z.number().int().min(1).max(200).default(30).describe("Maximum number of edits to list") },
    annotations: readOnly,
  },
  async ({ limit }) => {
    const { changes } = await data.changes();
    const rows = [];
    for (const c of changes) {
      for (const [label, list] of [["added", c.added], ["changed", c.changed], ["removed", c.removed]]) {
        for (const i of list || []) rows.push(`- ${c.date.slice(0, 10)} ${label}: ${i.name} (${i.type})`);
      }
    }
    return text(rows.length ? rows.slice(0, limit).join("\n") : "No wiki edits recorded yet.");
  },
);

await server.connect(new StdioServerTransport());
