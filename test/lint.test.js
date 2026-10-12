import { test } from "node:test";
import assert from "node:assert/strict";
import { lint, tokenize, closest } from "../src/lint.js";

const syntax = {
  commands: {
    player: { name: "player", forms: ["nullary"], status: "ok", syntax: ["player"] },
    setpos: { name: "setPos", forms: ["binary"], status: "ok", syntax: ["object setPos pos"] },
    getpos: { name: "getPos", forms: ["unary"], status: "ok", syntax: ["getPos object"] },
    hint: { name: "hint", forms: ["unary"], status: "ok", syntax: ["hint message"] },
    str: { name: "str", forms: ["unary"], status: "ok", syntax: ["str value"] },
    count: { name: "count", forms: ["binary", "unary"], status: "ok", syntax: ["count array"] },
    units: { name: "units", forms: ["unary"], status: "ok", syntax: ["units group"] },
    group: { name: "group", forms: ["unary"], status: "ok", syntax: ["group unit"] },
    alive: { name: "alive", forms: ["unary"], status: "ok", syntax: ["alive object"] },
    if: { name: "if", forms: ["unary"], status: "ok", syntax: ["if condition"] },
    then: { name: "then", forms: ["binary"], status: "ok", syntax: ["if then code"] },
    else: { name: "else", forms: ["binary"], status: "ok", syntax: ["code else code"] },
    foreach: { name: "forEach", forms: ["binary"], status: "ok", syntax: ["code forEach array"] },
    call: { name: "call", forms: ["binary", "unary"], status: "ok", syntax: ["args call code"] },
    private: { name: "private", forms: ["unary"], status: "ok", syntax: ["private var"] },
    params: { name: "params", forms: ["binary", "unary"], status: "ok", syntax: ["params [p]"] },
    setdamage: { name: "setDamage", forms: ["binary"], status: "ok", syntax: ["object setDamage damage"] },
    ctrlseteventhandler: {
      name: "ctrlSetEventHandler", forms: ["binary"], status: "deprecated", replaced_by: ["ctrlAddEventHandler"],
      syntax: ["control ctrlSetEventHandler [name, code]"],
    },
    diag_fps: { name: "diag_fps", forms: ["nullary"], status: "ok", branch: "diag", syntax: ["diag_fps"] },
    objnull: { name: "objNull", forms: ["nullary"], status: "ok", syntax: ["objNull"] },
  },
  functions: { bis_fnc_spawngroup: { name: "BIS_fnc_spawnGroup", status: "ok" } },
};

const errors = (code) => lint(code, syntax).filter((d) => d.severity === "error");

test("valid SQF has no findings", () => {
  const code = `
    private _pos = getPos player;
    player setPos _pos;
    if (alive player) then { hint str count units group player } else { hint "dead" };
    { _x setDamage 0 } forEach units group player;
    params [["_unit", objNull]];
    myGlobal = 5; hint str myGlobal;
    [] call BIS_fnc_spawnGroup;
    #define MACRO(x) x
    MACRO(1);
  `;
  assert.deepEqual(lint(code, syntax), []);
});

test("made-up commands are reported with their position", () => {
  const [d] = errors("player setUnitHealth 0.5;");
  assert.equal(d.line, 1);
  assert.equal(d.col, 8);
  assert.match(d.message, /Unknown command setUnitHealth \(used as a binary command\)/);
  assert.match(errors("hintSilentX \"x\";")[0].message, /Unknown command hintSilentX \(used as a unary command\)/);
});

test("wrong operand forms are reported with the syntax", () => {
  assert.match(errors("setPos [0, 0, 0];")[0].message, /setPos needs a left operand\. Syntax: `object setPos pos`/);
  assert.match(errors("hint;")[0].message, /hint needs an argument/);
});

test("unknown BIS functions, deprecated commands and diag-only commands", () => {
  assert.match(errors("[] call BIS_fnc_spawnGroupp;")[0].message, /Unknown function BIS_fnc_spawnGroupp\. Did you mean BIS_fnc_spawnGroup/);
  const d = lint('_c ctrlSetEventHandler ["ButtonClick", ""];', syntax);
  assert.equal(d[0].severity, "warning");
  assert.match(d[0].message, /deprecated\. Use ctrlAddEventHandler instead/);
  assert.equal(lint("hint str diag_fps;", syntax)[0].severity, "info");
});

test("typos of commands in variable position are a hint, ordinary variable names are not", () => {
  assert.match(lint("palyer setDamage 1;", syntax)[0].message, /Did you mean player/);
  assert.deepEqual(lint("unit1 setDamage 1; tanks setDamage 1;", syntax), []);
});

test("config classes and comments are skipped", () => {
  assert.deepEqual(lint("class CfgPatches { class x { units[] = {}; }; };", syntax).filter((d) => d.severity !== "info"), []);
  assert.deepEqual(lint("// setPos [0,0,0];\n/* hint; */ player setPos [0,0,0];", syntax), []);
});

test("tokenizer handles strings with doubled quotes and numbers", () => {
  const t = tokenize('hint "say ""hi"""; _a = 0x1F + 1.5e3;');
  assert.deepEqual(t.map((x) => x.type), ["ident", "string", "punct", "ident", "op", "number", "op", "number", "punct"]);
});

test("closest treats a swap of neighbouring letters as one edit", () => {
  assert.deepEqual(closest("palyer", ["player", "layer"], 1), ["player"]);
});
