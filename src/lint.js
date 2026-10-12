// A small static checker for SQF, built on the command forms in syntax.json (nullary / unary / binary).
//
// SQF has no keywords: every word is either a command, a function, or a variable. That allows a few checks
// that need no type information and produce few false positives:
//   - a word that is not a known command, but is used where only a command can stand (between two values,
//     or right before a value), is almost always a made-up command;
//   - a known command used in a form it does not have (setPos without a left operand, hint without an
//     argument);
//   - BIS_fnc_* names that do not exist;
//   - deprecated, broken and diagnostic-build-only commands and functions.
// Unknown words in variable positions are global variables and are left alone.

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

export function lint(code, syntax) {
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

export function format(diagnostics, code) {
  const lines = code.split("\n").length;
  const count = (s) => diagnostics.filter((d) => d.severity === s).length;
  const head = `Checked ${lines} line${lines === 1 ? "" : "s"}: ${count("error")} errors, ${count("warning")} warnings, ${count("info")} notes.`;
  if (!diagnostics.length) return head + " No problems found.";
  return [head, "", ...diagnostics.map((d) => `${d.line}:${d.col} ${d.severity}: ${d.message}`)].join("\n");
}
