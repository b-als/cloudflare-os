import {
  CAPNWEB_VALIDATE_BUILD, OBSERVABILITY, defineGadgetsWorker, textModules,
  type DurableObjectMigration, type WranglerExtras,
} from "@gadgets/scripts/worker-config";

export default defineGadgetsWorker({
  name: "gatekeeper-process",
  entrypoint: ".wrangler/validate/src/index.ts",
  compatibilityFlags: ["allow_irrevocable_stub_storage", "nodejs_als"],
  observability: OBSERVABILITY,
});

export const wrangler = {
  build: CAPNWEB_VALIDATE_BUILD,
  rules: textModules(["**/*.txt"]),
} satisfies WranglerExtras;

/** Project storage and workspace-bound facets retain their existing namespace migrations. */
export const migrations: DurableObjectMigration[] = [
  { tag: "v1", new_sqlite_classes: ["ProcessProjectDO", "ProcessProjectGatekeeper"] },
  { tag: "v2", new_sqlite_classes: ["ProcessInterviewGatekeeper"] },
];
