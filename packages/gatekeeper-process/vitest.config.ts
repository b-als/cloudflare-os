import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import capnwebValidate from "capnweb-validate/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    capnwebValidate(),
    cloudflareTest({
      main: "./__tests__/worker.ts",
      miniflare: {
        compatibilityDate: "2026-02-02",
        compatibilityFlags: ["allow_irrevocable_stub_storage", "nodejs_als"],
        durableObjects: {
          PROCESS_PROJECT: { className: "ProcessProjectDO", useSQLite: true },
          WORKSPACE: { className: "ProcessTestWorkspace", useSQLite: true },
          PROCESS_PROJECT_GATEKEEPER: { className: "ProcessProjectGatekeeper", useSQLite: true },
        },
      },
    }),
  ],
  test: {
    include: ["__tests__/*.test.ts"],
  },
});
