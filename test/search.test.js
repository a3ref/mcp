import { test } from "node:test";
import assert from "node:assert/strict";
import { search } from "../src/search.js";
import { Data, normalise } from "../src/data.js";

const items = [
  { name: "setPos", type: "command", md: "commands/setPos.md", json: "commands/setPos.json", groups: ["Positions"], syntax: ["object setPos pos"], summary: "Sets object position.", status: "ok", operator: null, aliases: [] },
  { name: "setPosATL", type: "command", md: "commands/setPosATL.md", json: "commands/setPosATL.json", groups: ["Positions"], syntax: [], summary: "Sets the position of an object above terrain.", status: "ok", operator: null, aliases: [] },
  { name: "attachTo", type: "command", md: "commands/attachTo.md", json: "commands/attachTo.json", groups: ["Object Manipulation"], syntax: [], summary: "Attaches an object to another object.", status: "ok", operator: null, aliases: [] },
  { name: "ctrlSetEventHandler", type: "command", md: "commands/ctrlSetEventHandler.md", json: "x", groups: ["GUI Control"], syntax: [], summary: "Sets an event handler of a control.", status: "deprecated", operator: null, aliases: [] },
  { name: "ctrlAddEventHandler", type: "command", md: "commands/ctrlAddEventHandler.md", json: "x", groups: ["GUI Control"], syntax: [], summary: "Adds an event handler to a control.", status: "ok", operator: null, aliases: [] },
  { name: "config greater greater name", type: "command", md: "commands/config_greater_greater_name.md", json: "x", groups: ["Config"], syntax: ["config >> name"], summary: "Returns a subentry.", status: "ok", operator: ">>", aliases: [] },
  { name: "BIS_fnc_spawnGroup", type: "function", md: "functions/BIS_fnc_spawnGroup.md", json: "x", groups: ["Object Manipulation"], syntax: [], summary: "Spawns a group.", status: "ok", operator: null, aliases: [] },
  { name: "Position", type: "topic", md: "topics/Position.md", json: "topics/Position.json", groups: ["Data Types"], syntax: [], summary: "Positions.", status: "ok", operator: null, aliases: ["PositionAGL", "Position3D"] },
  { name: "Arma 3: Event Handlers", type: "topic", md: "topics/Event_Handlers.md", json: "x", groups: ["Event Handlers"], syntax: [], summary: "Event handlers.", status: "ok", operator: null, aliases: [] },
];

test("exact name, operator symbol and function short name rank first", () => {
  assert.equal(search(items, "setpos")[0].name, "setPos");
  assert.equal(search(items, ">>")[0].name, "config greater greater name");
  assert.equal(search(items, "spawngroup")[0].name, "BIS_fnc_spawnGroup");
  assert.equal(search(items, "positionagl")[0].name, "Position");
});

test("keywords find entries by what they do; deprecated entries sink", () => {
  assert.equal(search(items, "attach object to vehicle")[0].name, "attachTo");
  const hits = search(items, "event handler control").map((e) => e.name);
  assert.ok(hits.indexOf("ctrlAddEventHandler") < hits.indexOf("ctrlSetEventHandler"));
  assert.deepEqual(search(items, "setpos", { type: "function" }), []);
});

test("find accepts any spelling", async () => {
  const data = new Data({ base: "https://example.test/", fetchImpl: async () => ({ ok: true, json: async () => ({ items }) }) });
  assert.equal((await data.find("SETPOS")).name, "setPos");
  assert.equal((await data.find("spawnGroup")).name, "BIS_fnc_spawnGroup");
  assert.equal((await data.find("bis fnc spawngroup")).name, "BIS_fnc_spawnGroup");
  assert.equal((await data.find(">>")).name, "config greater greater name");
  assert.equal((await data.find("Event Handlers")).name, "Arma 3: Event Handlers");
  assert.equal((await data.find("PositionAGL")).name, "Position");
  assert.equal(await data.find("noSuchThing"), null);
  assert.equal(normalise("createVehicle()"), "createvehicle");
});
