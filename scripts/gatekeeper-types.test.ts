import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";

// A gatekeeper hands its agent `src/types.txt` as the API contract, while its code compiles against
// `src/types.d.ts`. Upstream stores the .txt as a git symlink to the .d.ts, but a checkout without
// `core.symlinks` (the Windows default) writes a symlink out as a one-line file naming its target,
// so a gatekeeper developed there may commit a real copy instead. A copy drifts silently and leaves
// the agent reading a contract the gatekeeper no longer implements, so it must match exactly.
const normalize = (text: string) => text.replace(/\r\n/g, "\n");

it("every gatekeeper's runtime types contract matches its declaration", () => {
  let checked = 0;
  for (const name of readdirSync("packages")) {
    const src = join("packages", name, "src");
    if (!existsSync(src)) continue;
    for (const file of readdirSync(src).filter((entry) => entry.endsWith("types.txt"))) {
      const declaration = file.replace(/\.txt$/, ".d.ts");
      const dtsPath = join(src, declaration);
      if (!existsSync(dtsPath)) continue;
      const txt = readFileSync(join(src, file), "utf8");
      if (txt.trim() === declaration) continue;
      checked++;
      assert.equal(
        normalize(txt),
        normalize(readFileSync(dtsPath, "utf8")),
        `${name}: src/${file} has drifted from src/${declaration}. Copy the .d.ts over it.`,
      );
    }
  }
  assert.ok(checked > 0, "found no gatekeeper types.txt to check; is the working directory the repo root?");
});
