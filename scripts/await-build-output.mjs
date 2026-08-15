// Polls for a file to appear and be readable, with a configurable timeout.
// Extracted so the readiness logic can be unit-tested independently of capnweb-validate.

import { accessSync, constants } from "node:fs";

/**
 * Wait for `filePath` to exist and be readable.
 * @param {string} filePath   Absolute or relative path to the expected output file.
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=15000]   Maximum time to wait.
 * @param {number} [opts.intervalMs=150]    Polling interval.
 * @param {() => number} [opts.now]         Clock function (for testing).
 * @returns {Promise<void>} Resolves when the file is readable; rejects on timeout.
 */
export async function awaitFile(filePath, opts = {}) {
  const { timeoutMs = 15_000, intervalMs = 150, now = Date.now } = opts;
  const deadline = now() + timeoutMs;

  while (now() < deadline) {
    try {
      accessSync(filePath, constants.R_OK);
      return; // file is readable
    } catch {
      // not yet — wait and retry
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(
    `await-build-output: timed out after ${timeoutMs}ms waiting for ${filePath}`,
  );
}

/**
 * Synchronously check whether a file is readable right now.
 * @param {string} filePath
 * @returns {boolean}
 */
export function isFileReadable(filePath) {
  try {
    accessSync(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
