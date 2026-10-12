# a3ref MCP server — Arma 3 SQF reference and linter for AI agents

Gives Claude, Cursor, VS Code Copilot and any other [MCP](https://modelcontextprotocol.io) client the complete
Arma 3 scripting reference — every scripting command, every `BIS_fnc_*` function and the core concept pages
(data types, locality, scheduler, event handlers) — mirrored daily from the
[Bohemia Interactive Community Wiki](https://community.bistudio.com/wiki) by [a3ref](https://a3ref.github.io/),
plus a static checker that catches the mistakes models make most in SQF.

| Tool | What it does |
|---|---|
| `search` | Find commands, functions and topics by name, partial name, operator symbol (`>>`, `!=`) or by what they do ("delete vehicle") |
| `get` | Read a page: syntax, typed parameters, return value, locality, examples, community notes. Any spelling works (`SETPOS`, `spawnGroup`, `bis fnc spawngroup`); `section` returns one part of a long topic, e.g. one event handler |
| `list_group` | Everything in a command or function group ("Multiplayer", "Object Manipulation", ...) |
| `lint_sqf` | Check SQF: made-up commands, commands used without their left operand or argument, unknown `BIS_fnc_*` functions, deprecated or broken commands, diagnostic-build-only commands |
| `recent_changes` | What changed on the wiki recently |

Example `lint_sqf` output:

```text
Checked 3 lines: 2 errors, 1 warnings, 0 notes.

1:8 error: Unknown command setUnitHealth (used as a binary command).
2:1 error: setPos needs a left operand. Syntax: `object setPos pos`.
3:4 warning: ctrlSetEventHandler is deprecated. Use ctrlAddEventHandler instead.
```

The linter only reports what cannot be valid SQF, so it stays quiet on correct code: run over the 5,500 SQF
examples on the wiki it reports errors in 24, nearly all of them config or prose pasted into code blocks.

## Install

Requires Node.js 18 or newer. The server is a single file with no dependencies to install.

### Claude Code (plugin: MCP server + skill)

```text
/plugin marketplace add a3ref/mcp
/plugin install a3ref@a3ref
```

The plugin also adds the `sqf` skill, which tells Claude to check commands and lint SQF before showing it.

### Claude Code (server only)

```sh
claude mcp add a3ref -- npx -y github:a3ref/mcp
```

### Claude Desktop, Cursor, Windsurf and other clients

```json
{
  "mcpServers": {
    "a3ref": {
      "command": "npx",
      "args": ["-y", "github:a3ref/mcp"]
    }
  }
}
```

Claude Desktop: `claude_desktop_config.json`; Cursor: `.cursor/mcp.json`; Windsurf: `~/.codeium/windsurf/mcp_config.json`.

### VS Code (Copilot agent mode)

`.vscode/mcp.json`:

```json
{
  "servers": {
    "a3ref": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:a3ref/mcp"]
    }
  }
}
```

## How it works

The server downloads what it needs from https://a3ref.github.io/ (`index.json`, `syntax.json` and the pages
you ask for) and keeps it in memory for an hour. Nothing is bundled, so answers follow the wiki without
updating the server. Set `A3REF_BASE_URL` to use another copy of the site.

The data comes from [a3ref/data](https://github.com/a3ref/data); the site and the parser live in
[a3ref/a3ref.github.io](https://github.com/a3ref/a3ref.github.io). No MCP client? Every page is also plain
Markdown and JSON, see https://a3ref.github.io/llms.txt.

## Development

```sh
npm install
npm test          # unit tests, offline
npm run build     # bundles src/ into dist/a3ref-mcp.mjs (committed, so npx and the plugin need no install)
```

`dist/` must be rebuilt and committed with every change to `src/`; CI checks that it is up to date.

Content of the reference belongs to the authors of the BI Community Wiki. The code in this repository is MIT licensed.
