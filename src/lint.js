// A small static checker for SQF, built on the command forms in syntax.json (nullary / unary / binary).
//
// SQF has no keywords: every word is either a command, a function, or a variable. That allows a few checks
// that need no type information and produce few false positives:
//   - a word that is not a known command, but is used where only a command can stand (between two values,
//     or right before a value), is almost always a made-up command;
//   - a known command used in a form it does not have (setPos without a left operand, hint without an
//     argument);
//   - BIS_fnc_* names that do not exist;
//   - deprecated, broken and diagnostic-build-only commands and functions;
//   - format strings that use more %N than values are passed;
//   - event handler names that do not exist, or belong to another command (addEventHandler "Draw3D").
// Unknown words in variable positions are global variables and are left alone.
// The last two checks follow HEMTT's L-S08 and L-S02 (https://github.com/BrettMayson/HEMTT).

const TWO_CHAR_OPS = [">>", "==", "!=", ">=", "<=", "&&", "||"];
const ONE_CHAR = "+-*/%^!=<>:#;,()[]{}";
const UNARY_OPS = new Set(["!", "-", "+"]);

export function tokenize(code) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const advance = (n) => {
    for (let k = 0; k < n; k++) {
      if (code[i] === "\n") {
        line += 1;
        col = 1;
      } else col += 1;
      i += 1;
    }
  };
  let lineStart = true;
  while (i < code.length) {
    const rest = code.slice(i);
    const ch = code[i];
    if (ch === "\n") {
      advance(1);
      lineStart = true;
      continue;
    }
    if (/\s/.test(ch)) {
      advance(1);
      continue;
    }
    if (lineStart && ch === "#") {
      // preprocessor directive, including "\"-continued lines
      let m = rest.match(/^#[^\n]*(?:\\\r?\n[^\n]*)*/);
      advance(m[0].length);
      continue;
    }
    lineStart = false;
    let m;
    if ((m = rest.match(/^\/\/[^\n]*/)) || (m = rest.match(/^\/\*[\s\S]*?(\*\/|$)/))) {
      advance(m[0].length);
      continue;
    }
    const start = { line, col };
    if ((m = rest.match(/^"(?:[^"]|"")*"?/)) || (m = rest.match(/^'(?:[^']|'')*'?/))) {
      tokens.push({ type: "string", value: m[0], ...start });
      advance(m[0].length);
      continue;
    }
    if ((m = rest.match(/^(?:0x[0-9a-f]+|\$[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)/i))) {
      tokens.push({ type: "number", value: m[0], ...start });
      advance(m[0].length);
      continue;
    }
    if ((m = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/))) {
      tokens.push({ type: "ident", value: m[0], ...start });
      advance(m[0].length);
      continue;
    }
    if (rest.startsWith("#{")) {
      // HashMap literal `#{"key": value}` (Arma 3 2.24, see ctrlSetProperty): read it as the block that follows
      advance(1);
      continue;
    }
    const two = TWO_CHAR_OPS.find((op) => rest.startsWith(op));
    if (two) {
      tokens.push({ type: "op", value: two, ...start });
      advance(2);
      continue;
    }
    if (ONE_CHAR.includes(ch)) {
      tokens.push({ type: "()[]{};,".includes(ch) ? "punct" : "op", value: ch, ...start });
      advance(1);
      continue;
    }
    advance(1); // anything else (stray characters) is skipped
  }
  return tokens;
}

/** `events` (optional) is Data#events(): without it event handler names are not checked. */
export function lint(code, syntax, { events } = {}) {
  const diagnostics = [];
  if (/^\s*class\s+\w+[\s:{]/m.test(code) && !/^\s*private\b|\bcall\b|\bspawn\b/m.test(code)) {
    return [{ line: 1, col: 1, severity: "info", message: "This looks like a config (class ...), not SQF; only SQF is checked." }];
  }
  const tokens = skipConfigClasses(tokenize(code));
  const commands = syntax.commands;
  const functions = syntax.functions;
  const assigned = new Set();
  tokens.forEach((t, i) => {
    if (t.type === "ident" && tokens[i + 1]?.value === "=") assigned.add(t.value.toLowerCase());
    // a name in a string is a variable defined elsewhere: isNil "BIS_fnc_music_spawn", setVariable ["x", ...]
    if (t.type === "string" && /^.[A-Za-z_]\w*.$/.test(t.value)) assigned.add(t.value.slice(1, -1).toLowerCase());
  });
  const defined = new Set([...code.matchAll(/^\s*#define\s+(\w+)/gm)].map((m) => m[1].toLowerCase()));
  const hinted = new Set();

  const kindOf = (t) => {
    if (!t || t.type !== "ident") return null;
    const low = t.value.toLowerCase();
    if (low.startsWith("_")) return "local";
    if (commands[low]) return "command";
    if (functions[low]) return "function";
    if (defined.has(low) || /^[A-Z][A-Z0-9_]*$/.test(t.value)) return "macro";
    return "variable";
  };
  const forms = (t) => commands[t.value.toLowerCase()]?.forms || [];

  // a token that can start an operand ("strict": cannot be anything else)
  const strictStart = (t) => t && (t.type === "number" || t.type === "string" || kindOf(t) === "local" || "([{".includes(t.value) && t.type === "punct");
  const valueStart = (t) => {
    if (!t) return false;
    if (strictStart(t)) return true;
    if (t.type === "op") return UNARY_OPS.has(t.value);
    const k = kindOf(t);
    if (k === "command") {
      const f = forms(t);
      return f.includes("nullary") || f.includes("unary");
    }
    return k === "function" || k === "variable" || k === "macro";
  };
  // does the token end an operand, given what follows it?
  const valueEnd = (t, next) => {
    if (!t) return false;
    if (t.type === "number" || t.type === "string") return true;
    if (t.type === "punct") return ")]}".includes(t.value);
    if (t.type !== "ident") return false;
    const k = kindOf(t);
    if (k === "command") return forms(t).includes("nullary") && !strictStart(next);
    return true;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "ident") continue;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    const low = t.value.toLowerCase();
    const k = kindOf(t);
    const at = { line: t.line, col: t.col };

    if (k === "command") {
      const c = commands[low];
      notice(diagnostics, at, c);
      if (low === "format" || low === "formattext") formatArgs(diagnostics, tokens, i, c, defined);
      if (events && EVENT_COMMANDS[low]) eventName(diagnostics, tokens, i, c, EVENT_COMMANDS[low], events);
      const f = c.forms || [];
      if (!f.length) continue;
      const left = valueEnd(prev, t);
      const right = valueStart(next);
      const shape = left && right ? "binary" : right ? "unary" : left ? null : "nullary";
      const usage = c.syntax?.length ? ` Syntax: ${c.syntax.map((s) => "`" + s + "`").join(", ")}.` : "";
      if (shape === "unary" && !f.includes("unary") && f.includes("binary")) {
        diagnostics.push({ ...at, severity: "error", message: `${c.name} needs a left operand.${usage}` });
      } else if (shape === "nullary" && !f.includes("nullary")) {
        diagnostics.push({ ...at, severity: "error", message: `${c.name} needs an argument.${usage}` });
      } else if (shape === null && !f.includes("nullary")) {
        diagnostics.push({ ...at, severity: "error", message: `${c.name} is missing its right operand.${usage}` });
      } else if (shape === "binary" && !f.includes("binary") && strictStart(next)) {
        diagnostics.push({ ...at, severity: "warning", message: `${c.name} takes no left operand; is a ";" missing before it?${usage}` });
      }
      continue;
    }

    if (k === "function") {
      notice(diagnostics, at, functions[low]);
      continue;
    }

    if (k === "variable") {
      if (/^[a-z0-9]+_fnc_/i.test(t.value) && /^bis_fnc_/i.test(t.value) && !assigned.has(low)) {
        diagnostics.push({ ...at, severity: "error", message: `Unknown function ${t.value}.${suggest(low, Object.keys(functions), functions)}` });
        continue;
      }
      if (assigned.has(low)) continue;
      const asBinary = valueEnd(prev, t) && strictStart(next);
      const asUnary = !valueEnd(prev, t) && strictStart(next) && next.value !== "(";
      if (asBinary || asUnary) {
        diagnostics.push({
          ...at,
          severity: "error",
          message: `Unknown command ${t.value} (used as a ${asBinary ? "binary" : "unary"} command).${suggest(low, Object.keys(commands), commands)}`,
        });
      } else if (t.value.length >= 5 && !/\d/.test(t.value) && !hinted.has(low)) {
        // A likely typo ("palyer" -> player) is one edit away and starts with the same letter; names such as
        // tank (rank), unit (units) or myVehicle (vehicle) are ordinary variables.
        const near = closest(low, Object.keys(commands), 1)
          .filter((n) => n[0] === low[0] && !n.startsWith(low) && !low.startsWith(n));
        hinted.add(low);
        if (near.length) {
          diagnostics.push({
            ...at,
            severity: "info",
            message: `${t.value} is not a command, so it is read as a global variable. Did you mean ${near.map((n) => commands[n].name).join(" or ")}?`,
          });
        }
      }
    }
  }
  return diagnostics;
}

/** Drop config class blocks (`class Name: Base { ... };`) that often sit next to SQF in mod code. */
function skipConfigClasses(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "ident" && t.value === "class" && tokens[i + 1]?.type === "ident") {
      let j = i + 2;
      while (j < tokens.length && tokens[j].value !== "{" && tokens[j].value !== ";") j++;
      if (tokens[j]?.value === "{") {
        let depth = 0;
        for (; j < tokens.length; j++) {
          if (tokens[j].value === "{") depth++;
          else if (tokens[j].value === "}" && --depth === 0) break;
        }
      }
      i = j;
      continue;
    }
    out.push(t);
  }
  return out;
}

/** Tokens of the array literal that starts at tokens[i] (a "["), split into top-level elements; null if unclosed. */
function arrayElements(tokens, i) {
  const elements = [[]];
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    const v = tokens[j].type === "punct" ? tokens[j].value : null;
    if (v === "[" || v === "(" || v === "{") {
      if (depth++ === 0) continue;
    } else if (v === "]" || v === ")" || v === "}") {
      if (--depth === 0) return elements;
    } else if (v === "," && depth === 1) {
      elements.push([]);
      continue;
    }
    elements.at(-1).push(tokens[j]);
  }
  return null;
}

const unquote = (t) => t.value.slice(1, -1).replaceAll(t.value[0] + t.value[0], t.value[0]);

/** format ["%1 and %2", a]: a placeholder without a value. Extra values are harmless and not reported. */
function formatArgs(diagnostics, tokens, i, c, defined) {
  if (tokens[i + 1]?.value !== "[") return;
  const elements = arrayElements(tokens, i + 1);
  if (!elements || elements[0].length !== 1 || elements[0][0].type !== "string") return; // format [localize "STR_x", ...]
  // a macro can expand to several values
  if (elements.flat().some((t) => t.type === "ident" && (defined.has(t.value.toLowerCase()) || /^[A-Z][A-Z0-9_]*$/.test(t.value)))) return;
  const used = [...unquote(elements[0][0]).matchAll(/%(\d+)/g)].map((m) => Number(m[1]));
  const max = Math.max(0, ...used);
  const passed = elements.length - 1;
  if (max > passed) {
    const t = tokens[i];
    diagnostics.push({
      line: t.line,
      col: t.col,
      severity: "error",
      message: `${c.name} uses %${max} but passes ${passed} value${passed === 1 ? "" : "s"} after the format string.`,
    });
  }
}

// Commands that take an event handler name, by the kind of events they accept (see Data#events)
const EVENT_KINDS = {
  object: ["addEventHandler", "removeEventHandler", "removeAllEventHandlers"],
  mp: ["addMPEventHandler", "removeMPEventHandler", "removeAllMPEventHandlers"],
  mission: ["addMissionEventHandler", "removeMissionEventHandler", "removeAllMissionEventHandlers"],
  music: ["addMusicEventHandler", "removeMusicEventHandler", "removeAllMusicEventHandlers"],
  ui: [
    "ctrlAddEventHandler", "ctrlRemoveEventHandler", "ctrlRemoveAllEventHandlers", "ctrlSetEventHandler",
    "displayAddEventHandler", "displayRemoveEventHandler", "displayRemoveAllEventHandlers", "displaySetEventHandler",
  ],
};
const EVENT_COMMANDS = Object.fromEntries(
  Object.entries(EVENT_KINDS).flatMap(([kind, names]) => names.map((n) => [n.toLowerCase(), kind])),
);

/** addEventHandler ["Kiled", ...]: an event that does not exist, or that another command adds. */
function eventName(diagnostics, tokens, i, c, kind, events) {
  const known = events[kind];
  if (!known?.size) return; // the page could not be read
  let t = tokens[i + 1];
  if (t?.value === "[") t = tokens[i + 2];
  if (t?.type !== "string") return; // a variable or a macro
  const name = unquote(t);
  const low = name.toLowerCase();
  if (known.has(low) || (kind === "ui" && known.has(low.replace(/^on/, "")))) return;
  const at = { line: t.line, col: t.col };
  const other = Object.keys(EVENT_KINDS).find((k) => k !== kind && events[k]?.has(low));
  if (other) {
    diagnostics.push({ ...at, severity: "warning", message: `"${name}" is not an event of ${c.name}; add it with ${EVENT_KINDS[other][0]}.` });
    return;
  }
  const near = closest(low, [...known.keys()], Math.max(2, Math.floor(low.length / 4)));
  const hint = near.length ? ` Did you mean ${near.map((n) => known.get(n)).join(", ")}?` : "";
  diagnostics.push({ ...at, severity: "warning", message: `Unknown event "${name}" for ${c.name}.${hint}` });
}

function notice(diagnostics, at, entry) {
  if (!entry) return;
  const instead = entry.replaced_by?.length ? ` Use ${entry.replaced_by.join(" or ")} instead.` : "";
  if (entry.status === "deprecated") {
    diagnostics.push({ ...at, severity: "warning", message: `${entry.name} is deprecated.${instead}` });
  } else if (entry.status === "broken") {
    diagnostics.push({ ...at, severity: "warning", message: `${entry.name} is listed as broken on the wiki.${instead}` });
  }
  if (entry.branch) {
    diagnostics.push({ ...at, severity: "info", message: `${entry.name} only exists in ${entry.branch} builds of the game.` });
  }
}

function suggest(low, names, table) {
  const near = closest(low, names, Math.max(2, Math.floor(low.length / 4)));
  return near.length ? ` Did you mean ${near.map((n) => table[n].name).join(", ")}?` : "";
}

export function closest(word, names, maxDistance, limit = 3) {
  const scored = [];
  for (const n of names) {
    if (Math.abs(n.length - word.length) > maxDistance) continue;
    const d = distance(word, n, maxDistance);
    if (d <= maxDistance) scored.push([d, n]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length);
  return scored.slice(0, limit).map(([, n]) => n);
}

function distance(a, b, max) {
  // Edit distance where swapping two neighbouring letters counts as one edit ("palyer" -> "player"),
  // with an early exit once a whole row exceeds max.
  let before = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (before && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], before[j - 2] + 1);
      }
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    before = prev;
    prev = cur;
  }
  return prev[b.length];
}

const MAX_SHOWN = 100; // a whole mod in one call should not flood the context

export function format(diagnostics, code) {
  const lines = code.split("\n").length;
  const count = (s) => diagnostics.filter((d) => d.severity === s).length;
  const head = `Checked ${lines} line${lines === 1 ? "" : "s"}: ${count("error")} errors, ${count("warning")} warnings, ${count("info")} notes.`;
  if (!diagnostics.length) return head + " No problems found.";
  // errors first, so a cut list still shows what must be fixed
  const order = { error: 0, warning: 1, info: 2 };
  const shown = diagnostics.length > MAX_SHOWN ? [...diagnostics].sort((a, b) => order[a.severity] - order[b.severity]).slice(0, MAX_SHOWN) : diagnostics;
  const rest = diagnostics.length - shown.length;
  const more = rest ? ["", `... ${rest} more not shown; fix these and check again, or check the code in parts.`] : [];
  return [head, "", ...shown.map((d) => `${d.line}:${d.col} ${d.severity}: ${d.message}`), ...more].join("\n");
}
