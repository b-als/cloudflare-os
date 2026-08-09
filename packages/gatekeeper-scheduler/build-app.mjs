import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(fileURLToPath(import.meta.url), "..");
const watch = process.argv.includes("--watch");

const pnpmCommand = process.platform === "win32" ? process.execPath : "pnpm";
const pnpmArgs = process.platform === "win32"
  ? ["C:/Program Files/nodejs/node_modules/corepack/dist/corepack.js", "pnpm"]
  : [];
execFileSync(
  pnpmCommand,
  [...pnpmArgs, "exec", "vite", "build", "-c", "vite.config.ts", ...(watch ? ["--watch"] : [])],
  { cwd: packageDirectory, stdio: "inherit" },
);
