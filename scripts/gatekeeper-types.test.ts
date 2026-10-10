import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";

// A gatekeeper hands its agent `src/types.txt` as the API contract, while its code compiles against
// `src/types.d.ts`. Upstream stores the .txt as a git symlink to the .d.ts, but a checkout without
// `core.symlinks` (the Windows default) writes a symlink out as a one-line file naming its target,
// so a gatekeeper developed there may commit a real copy instead. A copy drifts silently and leaves
// the agent reading a contract the gatekeeper no longer implements, so it must match exactly.
const SYMLINK_ON_DISK = "types.d.ts";

const normalize = (text: string) => text.replace(/\r\n/g, "\n");

it("every gatekeeper's types.txt matches its types.d.ts", () => {
  let checked = 0;
  for (const name of readdirSync("packages")) {
    const txtPath = join("packages", name, "src", "types.txt");
    const dtsPath = join("packages", name, "src", "types.d.ts");
    if (!existsSync(txtPath) || !existsSync(dtsPath)) continue;
    const txt = readFileSync(txtPath, "utf8");
    if (txt.trim() === SYMLINK_ON_DISK) continue;
    checked++;
    assert.equal(
      normalize(txt),
      normalize(readFileSync(dtsPath, "utf8")),
      `${name}: src/types.txt has drifted from src/types.d.ts. Copy the .d.ts over it.`,
    );
  }
  assert.ok(checked > 0, "found no gatekeeper types.txt to check; is the working directory the repo root?");
});
