// Build the Context Library SPA into generated single-file HTML for startAppUi().

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = resolve(fileURLToPath(import.meta.url), "..");
const watch = process.argv.includes("--watch");

console.log(
  watch
    ? "watching context library app for changes…"
    : "building context library app single-file bundle…",
);
const pnpmCommand = process.platform === "win32" ? process.execPath : "pnpm";
const pnpmArgs = process.platform === "win32"
  ? ["C:/Program Files/nodejs/node_modules/corepack/dist/corepack.js", "pnpm"]
  : [];
execFileSync(
  pnpmCommand,
  [...pnpmArgs, "exec", "vite", "build", "-c", "vite.config.ts", ...(watch ? ["--watch"] : [])],
  { cwd: pkgDir, stdio: "inherit" },
);
