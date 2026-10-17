// a3ref MCP server: the Arma 3 scripting reference (https://a3ref.github.io) as tools for AI agents.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Data } from "./data.js";
import { search } from "./search.js";
import { lint, format } from "./lint.js";

const VERSION = "0.1.0";
const data = new Data();

const INSTRUCTIONS = `Arma 3 scripting reference (SQF), mirrored daily from the Bohemia Interactive Community Wiki.
Use it whenever you write, review or debug Arma 3 scripts, missions or mods:
- search: find commands, BIS_fnc_* functions and concept pages by name or by what they do.
- get: read one page (syntax, typed parameters, return value, locality, examples). Check status: deprecated and broken pages name a replacement.
- lint_sqf: check SQF before presenting it: catches made-up commands, wrong operand forms, unknown BIS_fnc_* functions and deprecated commands.
Do not rely on memory for SQF syntax; names are often similar and many commands are binary (left operand required).`;

const server = new McpServer({ name: "a3ref", version: VERSION }, { instructions: INSTRUCTIONS });
const readOnly = { readOnlyHint: true, openWorldHint: true };
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
      "BIS_fnc_ may be omitted. For long concept pages (e.g. Event Handlers) pass `section` to get only matching sections.",
    inputSchema: {
      name: z.string().min(1).describe('e.g. "createVehicle", "BIS_fnc_spawnGroup", "!=", "Event Handlers", "Position"'),
      format: z.enum(["markdown", "json"]).default("markdown").describe("markdown reads best; json has structured fields"),
      section: z.string().optional().describe('Topic pages only: heading text to match, e.g. "HandleDamage"'),
    },
    annotations: readOnly,
  },
  async ({ name, format, section }) => {
    const entry = await data.find(name);
    if (!entry) {
      const { items } = await data.index();
      const near = search(items, name, { limit: 5 });
      return fail(`No page named "${name}".` + (near.length ? ` Closest matches:\n${near.map(line).join("\n")}` : ""));
    }
    if (section && entry.type === "topic") {
      const page = await data.page(entry, "json");
      const want = section.toLowerCase();
      const parts = page.sections.filter((s) => (s.heading || "").toLowerCase().includes(want));
      if (!parts.length) {
        const headings = page.sections.map((s) => s.heading).filter(Boolean);
        return fail(`No section matching "${section}" in ${entry.name}. Sections: ${headings.join(", ")}`);
      }
      const body = parts.map((s) => `${"#".repeat(s.level)} ${s.heading}\n\n${s.markdown}`).join("\n\n");
      return text(`# ${entry.name}\n\n${body}\n\nSource: ${data.base}${entry.md}`);
    }
    const page = await data.page(entry, format);
    return text(format === "json" ? JSON.stringify(page, null, 1) : page);
  },
);

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
    for (const e of ofType) for (const g of e.groups) counts.set(g, (counts.get(g) || 0) + 1);
    if (!group) {
      const groups = [...counts].sort((a, b) => a[0].localeCompare(b[0]));
      return text(`${type} groups:\n${groups.map(([g, n]) => `- ${g} (${n})`).join("\n")}`);
    }
    const want = group.toLowerCase();
    const match = [...counts.keys()].find((g) => g.toLowerCase() === want) || [...counts.keys()].find((g) => g.toLowerCase().includes(want));
    if (!match) return fail(`No ${type} group "${group}". Call list_group without a group to see them all.`);
    const members = ofType.filter((e) => e.groups.includes(match)).sort((a, b) => a.name.localeCompare(b.name));
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
      "deprecated or broken commands, and diagnostic-build-only commands. Run it on SQF you wrote before presenting it. " +
      "Unknown words in variable positions are treated as global variables and are not reported.",
    inputSchema: { code: z.string().min(1).describe("SQF source code") },
    annotations: readOnly,
  },
  async ({ code }) => {
    const syntax = await data.syntax();
    return text(format(lint(code, syntax), code));
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
        for (const i of list) rows.push(`- ${c.date.slice(0, 10)} ${label}: ${i.name} (${i.type})`);
      }
    }
    return text(rows.length ? rows.slice(0, limit).join("\n") : "No wiki edits recorded yet.");
  },
);

await server.connect(new StdioServerTransport());
