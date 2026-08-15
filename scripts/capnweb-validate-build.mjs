#!/usr/bin/env node

// Wrapper around `pnpm exec capnweb-validate build` that verifies the expected
// output file is readable before returning. This eliminates a race condition on
// Windows where wrangler reads the `main` entrypoint before the validator's
// output is fully flushed to disk.
//
// Usage (in wrangler.jsonc build.command):
//   node ../../scripts/capnweb-validate-build.mjs
//
// The script reads `main` and `build` from the local wrangler.jsonc to derive
// both the capnweb-validate arguments and the expected output path, so no extra
// CLI flags are needed.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { awaitFile } from "./await-build-output.mjs";

const cwd = process.cwd();

// ---------------------------------------------------------------------------
// Read the gatekeeper's wrangler.jsonc to determine the expected entrypoint.
// The output directory is always .wrangler/validate (the standard convention).
// ---------------------------------------------------------------------------
const OUT_DIR = ".wrangler/validate";

let config;
try {
  config = parse(readFileSync(join(cwd, "wrangler.jsonc"), "utf8"));
} catch (err) {
  console.error(`capnweb-validate-build: cannot read wrangler.jsonc in ${cwd}: ${err.message}`);
  process.exit(1);
}

const mainEntry = config.main;
if (!mainEntry) {
  console.error("capnweb-validate-build: wrangler.jsonc has no 'main' field");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Run capnweb-validate build.
// ---------------------------------------------------------------------------
const isWin = process.platform === "win32";
const binName = isWin ? "capnweb-validate.cmd" : "capnweb-validate";
const localBin = join(cwd, "node_modules", ".bin", binName);

// On Windows .cmd files require shell:true for execFileSync to execute them.
// We scope it narrowly: only true on Windows, and only for .cmd invocations.
const winShell = isWin;

let buildOk = false;
try {
  execFileSync(localBin, ["build", "--out", OUT_DIR], { stdio: "inherit", cwd, shell: winShell });
  buildOk = true;
} catch { /* fall through */ }

if (!buildOk) {
  const pnpmBin = isWin ? "pnpm.cmd" : "pnpm";
  try {
    execFileSync(pnpmBin, ["exec", "capnweb-validate", "build", "--out", OUT_DIR], {
      stdio: "inherit",
      cwd,
      shell: winShell,
    });
  } catch (e) {
    console.error(`capnweb-validate-build: build failed (exit ${e.status})`);
    process.exit(e.status ?? 1);
  }
}

// ---------------------------------------------------------------------------
// Wait for the expected entrypoint to become readable.
// ---------------------------------------------------------------------------
const expectedFile = join(cwd, mainEntry);

try {
  await awaitFile(expectedFile, { timeoutMs: 15_000, intervalMs: 100 });
} catch (err) {
  console.error(
    `capnweb-validate-build: build exited successfully but the expected entrypoint\n` +
    `  ${expectedFile}\n` +
    `was not readable within 15 s. This is typically a filesystem flush race on Windows.\n` +
    `Check that capnweb-validate wrote the file and that the 'main' field in wrangler.jsonc\n` +
    `matches the --out directory structure.`,
  );
  process.exit(1);
}
