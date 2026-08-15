#!/usr/bin/env node

// start-local-dev.mjs - Portable launcher that starts the Wrangler backend
// (dev-server on port 9000) and the Vite frontend (on port 3000) side by side.
//
// Usage:   pnpm dev:local          (from cloudflare-os root)
//          node scripts/start-local-dev.mjs
//
// Environment:
//   VITE_BACKEND_HOST  defaults to localhost:9000
//   VITE_PORT          defaults to 3000
//
// The script forwards SIGINT/SIGTERM and terminates only its own children.
// Exits with non-zero code if either child fails.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const isWin = process.platform === "win32";

// ---------------------------------------------------------------------------
// Resolve the pnpm binary portably. On Windows, .cmd files cannot be spawned
// directly without shell:true, which triggers DEP0190. Instead we invoke
// cmd.exe /c with the resolved pnpm.cmd path - this avoids shell:true while
// still executing the .cmd shim correctly.
// ---------------------------------------------------------------------------
import { existsSync } from "node:fs";

export function resolvePnpmPath() {
  if (!isWin) return null;
  const pathDirs = (process.env.PATH || "").split(";");
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = join(dir, "pnpm.cmd");
    if (existsSync(candidate)) return candidate;
  }
  return "pnpm.cmd";
}

const pnpmCmdPath = resolvePnpmPath();

// ---------------------------------------------------------------------------
// Environment.
// ---------------------------------------------------------------------------
const BACKEND_HOST = process.env.VITE_BACKEND_HOST || "localhost:9000";
const VITE_PORT = process.env.VITE_PORT || "3000";

const env = {
  ...process.env,
  VITE_BACKEND_HOST: BACKEND_HOST,
};

// ---------------------------------------------------------------------------
// Spawn children.
// ---------------------------------------------------------------------------
const children = [];
let exiting = false;

function spawnChild(label, args, opts = {}) {
  let cmd, spawnArgs, spawnOpts;
  if (isWin) {
    // Invoke cmd.exe /c pnpm.cmd <args> to avoid shell:true DEP0190
    cmd = process.env.ComSpec || "cmd.exe";
    spawnArgs = ["/c", pnpmCmdPath, ...args];
    spawnOpts = { stdio: "inherit", cwd: opts.cwd || ROOT, env: { ...env, ...opts.extraEnv }, windowsHide: true };
  } else {
    cmd = "pnpm";
    spawnArgs = args;
    spawnOpts = { stdio: "inherit", cwd: opts.cwd || ROOT, env: { ...env, ...opts.extraEnv } };
  }
  const child = spawn(cmd, spawnArgs, spawnOpts);
  child._label = label;
  children.push(child);
  return child;
}

// Backend: run the dev-server script from root.
const backend = spawnChild("backend", ["run", "dev-server"]);

// Frontend: run vite directly in the frontend package directory so that
// --port is passed as a direct CLI arg to vite (not via nested pnpm --).
const frontend = spawnChild("frontend", ["exec", "vite", "--port", VITE_PORT], {
  cwd: join(ROOT, "packages", "workshop-frontend"),
});

// ---------------------------------------------------------------------------
// Exit handling - kill only our direct children using portable process APIs.
// ---------------------------------------------------------------------------
function killAll() {
  if (exiting) return;
  exiting = true;
  for (const child of children) {
    try {
      // child.kill sends SIGTERM on Unix. On Windows with shell:true it
      // kills the cmd.exe process tree via the internal handle.
      child.kill();
    } catch { /* already exited */ }
  }
}

let exitCode = 0;
let exited = 0;

function onChildExit(label, code, signal) {
  if (code !== 0 && code !== null) {
    console.error(`[start-local-dev] ${label} exited with code ${code}`);
    if (!exitCode) exitCode = code;
  } else if (signal) {
    console.error(`[start-local-dev] ${label} killed by ${signal}`);
  }
  exited++;
  // If one child dies, tear down the other.
  killAll();
  if (exited === children.length) {
    process.exit(exitCode);
  }
}

backend.on("exit", (c, s) => onChildExit("backend", c, s));
frontend.on("exit", (c, s) => onChildExit("frontend", c, s));

process.on("SIGINT", killAll);
process.on("SIGTERM", killAll);
// Windows: Ctrl-C sends SIGINT via libuv; no extra handling needed.

console.log(`[start-local-dev] backend  -> VITE_BACKEND_HOST=${BACKEND_HOST}`);
console.log(`[start-local-dev] frontend -> http://localhost:${VITE_PORT}`);
