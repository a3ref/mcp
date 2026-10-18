import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("VERSION, package.json and the plugin manifest agree", () => {
  const version = read("src/index.js").match(/const VERSION = "([^"]+)"/)[1];
  assert.equal(JSON.parse(read("package.json")).version, version);
  assert.equal(JSON.parse(read(".claude-plugin/plugin.json")).version, version);
});
