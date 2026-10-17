// PostToolUse hook: after an edit to src/ or test/, run the offline tests and rebuild dist/ so it never goes stale
// (CI fails when dist/ differs from a fresh build). Silent on success; failures go to Claude (exit 2).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const event = JSON.parse(readFileSync(0, "utf8"));
const root = resolve(process.env.CLAUDE_PROJECT_DIR || event.cwd || ".");
const rel = relative(root, resolve(event.tool_input?.file_path || "")).replaceAll("\\", "/");
if (!/^(src|test)\/.*\.m?js$/.test(rel) && rel !== "build.mjs") process.exit(0);
for (const cmd of ["npm test --silent", "npm run build --silent"]) {
  try {
    execSync(cmd, { cwd: root, stdio: "pipe", encoding: "utf8", timeout: 120_000 });
  } catch (e) {
    console.error(`\`${cmd}\` fails after editing ${rel}:\n${`${e.stdout || ""}${e.stderr || ""}`.slice(-3000)}`);
    process.exit(2);
  }
}
