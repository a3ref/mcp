import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSections, outline } from "../src/pages.js";

const s = (level, heading, markdown = heading + " text") => ({ level, heading, markdown });
const sections = [
  s(1, null, "Intro."),
  s(3, "Basic Event Handlers"),
  s(4, "Fired"),
  s(4, "FiredMan (Arma 3 v1.66)"),
  s(4, "HandleDamage"),
  s(3, "Group Event Handlers (Arma 3 v2.10)"),
  s(4, "UnitJoined"),
];

test("an exact heading wins over partial matches; a heading brings its subsections", () => {
  assert.deepEqual(pickSections(sections, "fired").map((x) => x.heading), ["Fired"]);
  assert.deepEqual(pickSections(sections, "FiredMan").map((x) => x.heading), ["FiredMan (Arma 3 v1.66)"]);
  assert.deepEqual(pickSections(sections, "fire").map((x) => x.heading), ["Fired", "FiredMan (Arma 3 v1.66)"]);
  assert.deepEqual(pickSections(sections, "Group Event Handlers").map((x) => x.heading), ["Group Event Handlers (Arma 3 v2.10)", "UnitJoined"]);
  assert.deepEqual(pickSections(sections, "nothing"), []);
});

test("the outline lists every heading and how to read one", () => {
  const out = outline({ name: "Arma 3: Event Handlers" }, { sections }, "https://a3ref.github.io/topics/Event_Handlers.md");
  assert.match(out, /^# Arma 3: Event Handlers\n\nIntro\.\n\n/);
  assert.match(out, /section` set to a heading \(e\.g\. "Fired"\)/);
  assert.match(out, /\n- Basic Event Handlers\n  - Fired\n  - FiredMan \(Arma 3 v1\.66\)\n/);
  assert.match(out, /Whole page: https:\/\/a3ref\.github\.io\/topics\/Event_Handlers\.md$/);
});
