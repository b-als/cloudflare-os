#!/usr/bin/env node

// Start the upstream Wrangler dev server and the Vite frontend together.
// Usage: pnpm dev:local [--port PORT] [--use-workers-ai-binding]
// VITE_BACKEND_HOST defaults to localhost:9000; VITE_PORT defaults to 3000.

import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBinEntry } from "./bin-entry.ts";
import { getDevServerConfig } from "./dev-server-config.ts";
import { killProcessTreeEscalating } from "./kill-process-tree.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FRONTEND_DIR = join(ROOT, "packages", "workshop-frontend");

/** Resolve both child commands without shell shims, including on Windows paths with spaces. */
export function getLocalDevCommands(args = [], env = process.env) {
  const { backendHost } = getDevServerConfig(args, env.VITE_BACKEND_HOST || "localhost:9000");
  const vitePort = env.VITE_PORT || "3000";
  if (!/^\d+$/.test(vitePort) || Number(vitePort) < 1 || Number(vitePort) > 65535) {
    throw new Error("VITE_PORT must be an integer between 1 and 65535.");
  }
  const viteEntry = resolveBinEntry(FRONTEND_DIR, "vite");
  if (!viteEntry) throw new Error("Vite is not installed. Run pnpm install first.");
  return {
    backendHost,
    vitePort,
    env: { ...env, VITE_BACKEND_HOST: backendHost },
    backend: [join(ROOT, "scripts", "run-dev-server.ts"), ...args],
    frontend: [viteEntry, "--port", vitePort],
  };
}

/** Launch the two servers and stop only their process trees when either exits or on interruption. */
export function startLocalDev() {
  let commands;
  try {
    commands = getLocalDevCommands(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const children = [];
  let stopping = false;
  const force = new AbortController();

  async function stop(code = 0, signal = "SIGTERM") {
    if (stopping) {
      force.abort();
      return;
    }
    stopping = true;
    await Promise.all(children
      .filter(child => child.pid && child.exitCode === null && child.signalCode === null)
      .map(child => killProcessTreeEscalating(child.pid, {
        initialSignal: signal,
        forceSignal: force.signal,
      })));
    process.exit(code);
  }

  function spawnChild(label, args, cwd) {
    const child = spawn(process.execPath, args, {
      stdio: "inherit", cwd, env: commands.env, windowsHide: true,
    });
    children.push(child);
    child.on("error", error => {
      console.error(`[start-local-dev] ${label} failed: ${error.message}`);
      void stop(1);
    });
    child.on("exit", (code, signal) => {
      if (stopping) return;
      if (code || signal) {
        console.error(`[start-local-dev] ${label} exited (${signal || code})`);
      }
      void stop(code ?? (signal ? 1 : 0));
    });
  }

  spawnChild("backend", commands.backend, ROOT);
  spawnChild("frontend", commands.frontend, FRONTEND_DIR);
  process.on("SIGINT", () => { void stop(130, "SIGINT"); });
  process.on("SIGTERM", () => { void stop(143); });

  console.log(`[start-local-dev] backend  -> http://${commands.backendHost}`);
  console.log(`[start-local-dev] frontend -> http://localhost:${commands.vitePort}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startLocalDev();
}
