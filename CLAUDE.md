@AGENTS.md

## Claude Code

Hooks in `.claude/settings.json` (scripts in `.claude/hooks/`): edits to `dist/` are blocked, and after an edit to
`src/` or `test/` the unit tests run and `dist/` is rebuilt; failures come back to you.
