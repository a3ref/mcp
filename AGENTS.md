# AGENTS.md

Instructions for AI coding agents working on this repository. What the server offers and how to install it is in
[README.md](README.md).

**a3ref/mcp** is an MCP server (stdio) and Claude Code plugin for the Arma 3 scripting reference. It reads the
live site https://a3ref.github.io/ (built by [a3ref/a3ref.github.io](https://github.com/a3ref/a3ref.github.io)
from [a3ref/data](https://github.com/a3ref/data)) and bundles no data.

## Layout

| Path | Contents |
|---|---|
| `src/index.js` | server: instructions and the five tools (`search`, `get`, `list_group`, `lint_sqf`, `recent_changes`) |
| `src/data.js` | fetches `index.json`, `syntax.json`, `changes.json` and pages from the site; 1 h in-memory cache; `A3REF_BASE_URL` overrides the site |
| `src/search.js` | ranking for `search` |
| `src/pages.js` | sections and outlines of topic pages for `get` |
| `src/lint.js` | SQF tokenizer and static checks for `lint_sqf` |
| `test/*.test.js` | offline unit tests (`node --test`) |
| `test/smoke.mjs` | starts `dist/` and calls every tool against the live site |
| `dist/a3ref-mcp.mjs` | **generated** single-file bundle (esbuild via `build.mjs`), committed so `npx github:a3ref/mcp` and the plugin need no install |
| `.claude-plugin/`, `.mcp.json`, `skills/sqf/SKILL.md` | Claude Code marketplace, plugin manifest, server config and the `sqf` skill |

## Commands

```sh
npm install        # once; dev dependencies only (the bundle has no runtime dependencies)
npm test           # offline unit tests, <1 s
npm run build      # rebuild dist/ (<1 s); commit it together with src/
npm run smoke      # bundle against the live site (network)
```

## Verify a change

1. `npm test` passes and `npm run build` leaves `dist/` matching `src/`; CI fails otherwise. In Claude Code a hook
   runs both after every edit to `src/` or `test/`.
2. `npm run smoke` passes.
3. Tool behavior changed: call the tool through the bundle and read its output as an agent would
   (the smoke test shows how).
4. Linter changed: add cases to `test/lint.test.js`, both code that must be reported and correct code that must
   stay quiet.

## Rules

- **English only** in everything committed.
- **Never edit `dist/`** (a hook blocks it); edit `src/` and rebuild.
- **No runtime dependencies** beyond what esbuild bundles; Node 18+ built-ins only (global `fetch`).
- **Tool names, descriptions, parameter descriptions and `INSTRUCTIONS` are prompts** that every client puts into the
  model's context. Keep them short, concrete, with examples; keep tool outputs compact (Markdown, no pretty-printed
  JSON unless asked); errors say what to try next. Renaming a tool breaks users' configurations.
- **The linter reports only what cannot be valid SQF.** A false positive costs more than a missed error: unknown
  words in variable positions are global variables, and every new check must stay quiet on correct code.
- **Data contract**: the server relies on `index.json` (`name`, `type`, `syntax`, `summary`, `groups`, `status`,
  `operator`, `aliases`, `md`, `json`), `syntax.json` (`commands`/`functions` by lower-case name: `forms`, `status`,
  `replaced_by`, `branch`, `syntax`), topic pages' `sections` and `changes.json`. They are produced by
  `biwiki/render.py` in [a3ref/a3ref.github.io](https://github.com/a3ref/a3ref.github.io); change both sides
  together.
- **Versions**: `VERSION` in `src/index.js`, `package.json` and `.claude-plugin/plugin.json` stay equal.
- Pushing to `main` publishes the plugin to every user; get the maintainer's consent first.

## Conventions

ES modules, two-space indent, double quotes, comments that explain why. Commit messages: one plain sentence saying
what changed and why, no prefixes.
