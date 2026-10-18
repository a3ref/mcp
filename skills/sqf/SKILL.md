---
name: sqf
description: Look up Arma 3 SQF scripting commands, BIS_fnc_* functions, data types and event handlers, and check SQF code for made-up, misused or deprecated commands. Use when writing, reviewing or debugging Arma 3 scripts (.sqf), mission files (init.sqf, description.ext), Eden attributes or mods.
---

# Arma 3 SQF with the a3ref reference

SQF has more than 2,600 commands and 2,000 functions with similar names, and most commands take a fixed form:
nullary (`time`), unary (`alive unit`) or binary (`unit setPos pos`). Models often invent commands or use the
wrong form, so check instead of recalling.

## While writing SQF

1. Not sure a command exists or how it is called: `search` with the name or with what it should do
   (for example "attach object to vehicle"), then `get` the page.
2. Before using a command, read its page with `get`: syntax and operand order, parameter types, return value,
   locality (whether arguments must be local, whether the effect is global) and the Arma 3 version that added it.
   Pages with `status: deprecated` or `broken` name what to use instead.
3. Concepts such as data types, `Position` formats, locality, the scheduler and event handlers have topic pages:
   `get` "Multiplayer Scripting", "Position" with type "topic" (`position` is also a command), "Event Handlers"
   (long pages return an outline; use `section` for one handler, e.g. "HandleDamage").

## Before presenting SQF

Run `lint_sqf` on the code. Fix every error (unknown commands, missing operands, unknown BIS_fnc_* functions)
and every deprecation warning, then show the result. Unknown words in variable positions are global variables
and are not reported.

## Without the MCP tools

Every page is also plain Markdown or JSON at a stable URL:
`https://a3ref.github.io/commands/<name>.md`, `https://a3ref.github.io/functions/<BIS_fnc_name>.md`,
`https://a3ref.github.io/topics/<topic>.md`; lower-case paths work too. The list of names is at
https://a3ref.github.io/names.txt and the guide for language models at https://a3ref.github.io/llms.txt.
