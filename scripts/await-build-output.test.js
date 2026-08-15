import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { awaitFile, isFileReadable } from "./await-build-output.mjs";

const SCRATCH = join(import.meta.dirname, ".test-scratch-await");

describe("isFileReadable", () => {
  it("returns true for an existing file", () => {
    mkdirSync(SCRATCH, { recursive: true });
    const p = join(SCRATCH, "exists.txt");
    writeFileSync(p, "ok");
    try {
      assert.equal(isFileReadable(p), true);
    } finally {
      unlinkSync(p);
    }
  });

  it("returns false for a missing file", () => {
    assert.equal(isFileReadable(join(SCRATCH, "no-such-file.txt")), false);
  });
});

describe("awaitFile", () => {
  it("resolves immediately when file already exists", async () => {
    mkdirSync(SCRATCH, { recursive: true });
    const p = join(SCRATCH, "ready.txt");
    writeFileSync(p, "data");
    try {
      await awaitFile(p, { timeoutMs: 500, intervalMs: 10 });
    } finally {
      unlinkSync(p);
    }
  });

  it("resolves when file appears before timeout", async () => {
    mkdirSync(SCRATCH, { recursive: true });
    const p = join(SCRATCH, "delayed.txt");
    // Create file after 80ms
    setTimeout(() => writeFileSync(p, "appeared"), 80);
    try {
      await awaitFile(p, { timeoutMs: 2000, intervalMs: 20 });
    } finally {
      try { unlinkSync(p); } catch { /* ignore */ }
    }
  });

  it("rejects on timeout when file never appears", async () => {
    const p = join(SCRATCH, "never.txt");
    await assert.rejects(
      () => awaitFile(p, { timeoutMs: 200, intervalMs: 20 }),
      (err) => {
        assert.match(err.message, /timed out/);
        assert.match(err.message, /never\.txt/);
        return true;
      },
    );
  });
});

// Cleanup scratch dir
import { rmSync } from "node:fs";
process.on("exit", () => {
  try { rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* ignore */ }
});
