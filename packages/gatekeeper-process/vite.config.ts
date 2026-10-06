import { defineConfig } from "vite-plus";
import { vitestTask } from "@gadgets/scripts/vitest-task";

/** Register Process Studio's tests with the workspace task runner. */
export default defineConfig({
  run: {
    tasks: {
      test: vitestTask(["vitest run"]),
    },
  },
});
