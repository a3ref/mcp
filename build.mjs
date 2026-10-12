// Bundles the server into one dependency-free file, so `npx github:a3ref/mcp` and the plugin need no install.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.js"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: "dist/a3ref-mcp.mjs",
  // CommonJS dependencies inside the ESM bundle may call require() for Node built-ins
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: "none",
});
