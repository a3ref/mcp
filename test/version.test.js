import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("VERSION, package.json and the plugin manifests agree", () => {
  const version = read("src/index.js").match(/const VERSION = "([^"]+)"/)[1];
  // Claude Code, Codex and Antigravity each read their own manifest
  for (const path of ["package.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "plugin.json"]) {
    assert.equal(JSON.parse(read(path)).version, version, path);
  }
});

test("every plugin starts the same server", () => {
  // Claude Code expands CLAUDE_PLUGIN_ROOT; Codex resolves cwd against the plugin root; Antigravity has neither
  // and runs the published package
  const servers = (path) => JSON.parse(read(path)).mcpServers;
  assert.deepEqual(servers(".mcp.json").a3ref.args, ["${CLAUDE_PLUGIN_ROOT}/dist/a3ref-mcp.mjs"]);
  assert.deepEqual(servers(".codex-plugin/mcp.json").a3ref, { command: "node", args: ["./dist/a3ref-mcp.mjs"], cwd: "." });
  assert.deepEqual(servers("mcp_config.json").a3ref, { command: "npx", args: ["-y", "a3ref-mcp"] });
  assert.equal(JSON.parse(read(".codex-plugin/plugin.json")).mcpServers, "./.codex-plugin/mcp.json");
});
