// Build: main.js + kópia do test-vault/.obsidian/plugins/note-router.
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const VAULT_PLUGIN_DIR = "test-vault/.obsidian/plugins/note-router";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  platform: "browser",
  target: "es2020",
  minify: true,
  outfile: "main.js",
  logLevel: "info",
});

fs.mkdirSync(VAULT_PLUGIN_DIR, { recursive: true });
for (const f of ["main.js", "manifest.json"]) fs.copyFileSync(f, path.join(VAULT_PLUGIN_DIR, f));
console.log(`[note-router] built -> ${VAULT_PLUGIN_DIR}`);
