// Starts the bundled server and calls every tool over stdio against the live site.
// Run by CI after the build; not part of the offline unit tests.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke", version: "1" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/a3ref-mcp.mjs"] }));
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  assert.ok(!r.isError, `${name} failed: ${r.content[0].text}`);
  return r.content[0].text;
};
const tools = (await client.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(tools, ["get", "lint_sqf", "list_group", "recent_changes", "search"]);
assert.match(await call("search", { query: "setpos", limit: 3 }), /- setPos /);
assert.match(await call("get", { name: "SETPOS" }), /^---\nname: "setPos"/);
assert.match(await call("get", { name: "Event Handlers", section: "HandleDamage" }), /HandleDamage/);
assert.match(await call("list_group", {}), /Object Manipulation/);
assert.match(await call("lint_sqf", { code: "setPos [0,0,0];" }), /setPos needs a left operand/);
await call("recent_changes", { limit: 3 });
await client.close();
console.log("smoke test passed");
