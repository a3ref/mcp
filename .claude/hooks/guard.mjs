// PreToolUse hook: dist/ is generated; refuse direct edits (exit 2 = block, stderr goes to Claude).
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const event = JSON.parse(readFileSync(0, "utf8"));
const file = event.tool_input?.file_path;
if (!file) process.exit(0);
const rel = relative(resolve(process.env.CLAUDE_PROJECT_DIR || event.cwd || "."), resolve(file)).replaceAll("\\", "/");
if (rel.startsWith("dist/")) {
  console.error(`Blocked: ${rel} is the bundle built from src/. Edit src/ instead; it is rebuilt after each edit (npm run build).`);
  process.exit(2);
}
