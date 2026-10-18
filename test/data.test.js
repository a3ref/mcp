import { test } from "node:test";
import assert from "node:assert/strict";
import { Data, eventNames } from "../src/data.js";

const entry = (name, type, extra = {}) => ({ name, type, md: `${type}s/${name}.md`, json: `${type}s/${name}.json`, groups: [], aliases: [], ...extra });
const items = [
  entry("blufor", "command", { aliases: ["west"] }),
  entry("west", "command"),
  entry("position", "command"),
  entry("Position", "topic", { aliases: ["PositionAGL"] }),
];
const json = (value) => async () => ({ ok: true, json: async () => value });

test("an exact name wins over another page's alias; same-named pages of other types are all found", async () => {
  const data = new Data({ fetchImpl: json({ items }) });
  assert.equal((await data.find("west")).name, "west");
  assert.equal((await data.find("Position")).type, "command");
  assert.equal((await data.find("Position", "topic")).type, "topic");
  assert.deepEqual((await data.lookup("position")).map((e) => e.type), ["command", "topic"]);
  assert.deepEqual(await data.lookup("west", "function"), []);
});

test("one download for parallel calls; an old copy is served when the site fails", async () => {
  let calls = 0;
  let up = true;
  const data = new Data({
    fetchImpl: async () => {
      calls++;
      if (!up) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      return { ok: true, json: async () => ({ items }) };
    },
  });
  await Promise.all([data.index(), data.index(), data.find("west")]);
  assert.equal(calls, 1);
  up = false;
  data.cache.get("index.json").at = 0; // expired
  assert.equal((await data.find("west")).name, "west");
  await data.find("west"); // the failed refresh is not retried at once
  assert.equal(calls, 2);
  await assert.rejects(data.get("syntax.json"), /Cannot reach https:\/\/a3ref\.github\.io\/syntax\.json \(ECONNREFUSED\)\. Check the network/);
});

test("a stalled site times out with a message that says what to do", async () => {
  const data = new Data({
    timeout: 50,
    fetchImpl: (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
  });
  // AbortSignal.timeout does not keep the event loop alive (the stdio server does); without this timer
  // Node 22 ends the test before the timeout fires
  const alive = setInterval(() => {}, 1000);
  await assert.rejects(data.get("index.json"), /Cannot reach .*index\.json \(no answer in 0\.05 s\)/).finally(() => clearInterval(alive));
  const notFound = new Data({ fetchImpl: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(notFound.get("x.json"), (err) => err.status === 404);
});

test("event names come from the headings of the event handler pages", () => {
  const s = (level, heading) => ({ level, heading, markdown: "" });
  const kinds = eventNames(
    { sections: [s(1, null), s(3, "Basic Event Handlers"), s(4, "Deleted (Entity) (Arma 3 v1.68)"), s(4, "Killed"),
      s(3, "Multiplayer Event Handlers"), s(4, "MPHit"), s(3, "UserAction Event Handlers (Arma 3 v2.06)"), s(4, "Activate"),
      s(3, "Group Event Handlers (Arma 3 v2.10)"), s(4, "Deleted (Group)"), s(4, "UnitJoined"), s(3, "Music Event Handlers"), s(4, "MusicStart (Arma 3 v0.50)")] },
    { sections: [s(3, "Events"), s(5, "Draw3D (Arma 3 v0.50)"), s(5, "HandleDisconnect (Arma 3 v1.32 Server Execution)")] },
    { sections: [s(4, "Button Events"), s(5, "onButtonClick"), s(5, "onLBSelChanged")] },
  );
  assert.deepEqual([...kinds.object.values()], ["Deleted", "Killed", "UnitJoined"]);
  assert.deepEqual([...kinds.mp.values()], ["MPHit"]);
  assert.deepEqual([...kinds.music.values()], ["MusicStart"]);
  assert.deepEqual([...kinds.mission.values()], ["Draw3D", "HandleDisconnect"]);
  assert.deepEqual([...kinds.ui.values()], ["ButtonClick", "LBSelChanged"]);
});
