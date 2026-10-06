import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyLifecycleOps, emptyLifecycle, validateBaseline } from "../src/lifecycle.js";
import { domainName } from "../src/domain.js";
import type { BaArtifact, BaBaselineContent, GraphOp, LifecycleOp, ProcessGraph } from "../src/types.js";
import type { ProcessProjectDO } from "../src/project-do.js";
import type { ProcessTestWorkspace } from "./worker.js";

const testEnv = env as unknown as {
  PROCESS_PROJECT: DurableObjectNamespace<ProcessProjectDO>;
  WORKSPACE: DurableObjectNamespace<ProcessTestWorkspace>;
};
const GRAPH: ProcessGraph = {
  revision: 0, lanes: [{ id: "operations", label: "Operations" }],
  nodes: [
    { id: "start", type: "startEvent", label: "Request received", laneId: "operations", x: 0, y: 0 },
    { id: "check", type: "userTask", label: "Review request", laneId: "operations", owner: "Operations", x: 100, y: 0 },
    { id: "end", type: "endEvent", label: "Request reviewed", laneId: "operations", x: 200, y: 0 },
  ],
  edges: [{ id: "flow1", source: "start", target: "check" }, { id: "flow2", source: "check", target: "end" }],
};
const ARTIFACTS: BaArtifact[] = [
  { kind: "outcome", id: "speed", title: "Faster reviews", metric: "Median review duration", unit: "hours",
    baseline: 4, target: 2, direction: "decrease" },
  { kind: "stakeholder", id: "ops", title: "Operations lead", role: "Review owner", notes: "Consulted in interview" },
  { kind: "requirement", id: "review", title: "Review every request", statement: "Operations reviews each complete request.",
    priority: "must", acceptanceCriteria: ["A completed request reaches the reviewed end event."],
    outcomeIds: ["speed"], stakeholderIds: ["ops"], nodeIds: ["check"], source: "Operations interview" },
  { kind: "scenario", id: "happy", title: "Complete request", requirementIds: ["review"],
    pathNodeIds: ["start", "check", "end"], expected: "Request reviewed", actual: "Walkthrough completed with Operations",
    status: "passed" },
];
const OPS: LifecycleOp[] = ARTIFACTS.map((artifact) => ({ op: "putArtifact", artifact }));
const MODEL_OPS: GraphOp[] = [
  ...GRAPH.lanes.map((lane): GraphOp => ({ op: "addLane", lane })),
  ...GRAPH.nodes.map((node): GraphOp => ({ op: "addNode", node })),
  ...GRAPH.edges.map((edge): GraphOp => ({ op: "addEdge", edge })),
];
function content(): BaBaselineContent {
  return { projectId: "project", name: "Review process", revision: 1,
    asIs: structuredClone(GRAPH), toBe: structuredClone(GRAPH),
    artifacts: structuredClone(ARTIFACTS), decisions: [], openQuestions: [] };
}
function native<T extends object>(stub: T): T {
  return new Proxy(stub, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      return typeof value === "function"
        ? (...args: unknown[]) => Promise.resolve(Reflect.apply(value, target, args)) : value;
    },
  });
}
async function project() {
  const projectId = crypto.randomUUID();
  const stub = native(testEnv.PROCESS_PROJECT.getByName(domainName("lifecycle-test", projectId)));
  await stub.init(projectId, "Review process", "owner-account", "lifecycle-test");
  return { projectId, stub };
}

describe("persistent BA lifecycle", () => {
  it("enforces the payload limit in UTF-8 bytes, including multibyte evidence", () => {
    const ops: LifecycleOp[] = Array.from({ length: 90 }, (_, index) => ({
      op: "putArtifact",
      artifact: { kind: "stakeholder", id: `person-${index}`,
        title: "\u00e9".repeat(4000), role: "\u00e9".repeat(4000), notes: "\u00e9".repeat(4000) },
    }));
    expect(() => applyLifecycleOps(emptyLifecycle(), ops)).toThrow(/2 MB/);
  });

  it("validates forward references atomically and keeps the original state immutable", () => {
    const original = emptyLifecycle();
    const next = applyLifecycleOps(original, OPS.toReversed(), MODEL_OPS);
    expect(original.artifacts).toEqual([]);
    expect(original.toBe.nodes).toEqual([]);
    expect(next.artifacts).toHaveLength(4);
    expect(next.toBe.nodes).toHaveLength(3);
    expect(validateBaseline(content())).toEqual([]);
  });

  it("rejects orphaned references, invalid scenario paths, and unfounded validation results", () => {
    const state = applyLifecycleOps(emptyLifecycle(), OPS, MODEL_OPS);
    expect(() => applyLifecycleOps(state, [{ op: "deleteArtifact", id: "speed" }])).toThrow(/Unknown outcome/);
    expect(() => applyLifecycleOps(state, [], [{ op: "deleteNode", id: "check" }])).toThrow(/Unknown target/);
    expect(() => applyLifecycleOps(state, [{ op: "putArtifact", artifact: {
      kind: "scenario", id: "invalid", title: "Skip review", requirementIds: ["review"],
      pathNodeIds: ["start", "end"], expected: "End", actual: "Test", status: "passed",
    } }])).toThrow(/no flow/);
    expect(() => applyLifecycleOps(state, [{ op: "putArtifact", artifact: {
      kind: "scenario", id: "invalid", title: "No evidence", requirementIds: ["review"],
      pathNodeIds: ["start", "check"], expected: "Review", actual: "", status: "passed",
    } }])).toThrow(/actual result/);
  });

  it("validates numeric bounds, future measurements, and resolution evidence", () => {
    const state = applyLifecycleOps(emptyLifecycle(), OPS, MODEL_OPS);
    expect(() => applyLifecycleOps(state, [{ op: "putArtifact", artifact: {
      kind: "measurement", id: "metric", title: "Observation", outcomeId: "speed",
      value: Number.NaN, measuredAt: Date.now(), source: "Operations report",
    } }])).toThrow(/finite/);
    expect(() => applyLifecycleOps(state, [{ op: "putArtifact", artifact: {
      kind: "measurement", id: "metric", title: "Observation", outcomeId: "speed",
      value: 2, measuredAt: Date.now() + 100_000, source: "Operations report",
    } }])).toThrow(/non-future/);
    expect(() => applyLifecycleOps(state, [{ op: "putArtifact", artifact: {
      kind: "finding", id: "finding", title: "Gap", scenarioId: "", severity: "blocking",
      status: "resolved", resolution: "",
    } }])).toThrow(/resolution/);
  });

  it("checks every graph path rather than just one happy path", () => {
    const baseline = content();
    baseline.toBe.nodes.push({ id: "orphan", type: "userTask", label: "Unreachable", laneId: "operations", x: 0, y: 0 });
    const codes = validateBaseline(baseline).map((issue) => issue.code);
    expect(codes).toContain("graph.unreachable");
    expect(codes).toContain("graph.deadend");
    expect(codes).toContain("graph.owner");
    const empty = content();
    empty.artifacts = [];
    expect(validateBaseline(empty).map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "outcomes.missing", "requirements.missing", "stakeholders.missing",
    ]));
  });

  it("accepts split-and-merge gateways and rejects partial validation walkthroughs", () => {
    const baseline = content();
    baseline.toBe.nodes.push(
      { id: "split", type: "parallelGateway", label: "Split", laneId: "operations", x: 0, y: 0 },
      { id: "other", type: "userTask", label: "Other check", laneId: "operations", owner: "Operations", x: 0, y: 0 },
      { id: "join", type: "parallelGateway", label: "Merge", laneId: "operations", x: 0, y: 0 },
    );
    baseline.toBe.edges = [
      { id: "a", source: "start", target: "split" }, { id: "b", source: "split", target: "check" },
      { id: "c", source: "split", target: "other" }, { id: "d", source: "check", target: "join" },
      { id: "e", source: "other", target: "join" }, { id: "f", source: "join", target: "end" },
    ];
    baseline.artifacts = baseline.artifacts.map((artifact) => artifact.kind === "scenario"
      ? { ...artifact, pathNodeIds: ["start", "split", "check", "join", "end"] } : artifact);
    expect(validateBaseline(baseline)).toEqual([]);
    baseline.artifacts = baseline.artifacts.map((artifact) => artifact.kind === "scenario"
      ? { ...artifact, pathNodeIds: ["check"] } : artifact);
    expect(validateBaseline(baseline).map((issue) => issue.code)).toContain("validation.coverage");
  });

  it("blocks failed scenarios and unresolved blocking findings", () => {
    const baseline = content();
    baseline.artifacts = baseline.artifacts.map((artifact) =>
      artifact.kind === "scenario" ? { ...artifact, status: "failed" } : artifact);
    baseline.artifacts.push({ kind: "finding", id: "gap", title: "Unresolved gap", scenarioId: "happy",
      severity: "blocking", status: "open", resolution: "" });
    expect(validateBaseline(baseline).map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "validation.coverage", "validation.failed", "findings.blocking",
    ]));
  });

  it("persists separate models, rejects stale edits, and broadcasts lifecycle changes", async () => {
    const { projectId, stub } = await project();
    await stub.applyOps({ clientOpId: "current", baseRevision: 0, ops: MODEL_OPS }, "user");
    const snapshot = await stub.applyLifecycle({ clientOpId: "target", baseRevision: 1, ops: OPS, modelOps: MODEL_OPS });
    expect(snapshot.graph.nodes).toHaveLength(3);
    expect(snapshot.lifecycle?.toBe.nodes).toHaveLength(3);
    await expect(stub.applyLifecycle({ clientOpId: "stale", baseRevision: 1, ops: OPS })).rejects.toThrow(/changed/);
    const fresh = native(testEnv.PROCESS_PROJECT.getByName(domainName("lifecycle-test", projectId)));
    expect((await fresh.snapshot()).lifecycle?.artifacts).toHaveLength(4);
    await stub.applyLifecycle({ clientOpId: "rename", baseRevision: 2, ops: [],
      modelOps: [{ op: "updateNode", id: "check", label: "Target review" }] });
    expect((await stub.snapshot()).graph.nodes[1]?.label).toBe("Review request");
    expect((await stub.snapshot()).lifecycle?.toBe.nodes[1]?.label).toBe("Target review");
  });

  it("preserves model-specific locks", async () => {
    const { stub } = await project();
    await stub.applyOps({ clientOpId: "current", baseRevision: 0, ops: MODEL_OPS }, "user");
    await stub.applyLifecycle({ clientOpId: "target", baseRevision: 1, ops: OPS, modelOps: MODEL_OPS });
    await stub.recordDecision({ model: "toBe", summary: "Target fixed", rationale: "Policy",
      nodeIds: ["check"], edgeIds: [] }, "user");
    await expect(stub.applyLifecycle({ clientOpId: "locked", baseRevision: 3, ops: [],
      modelOps: [{ op: "updateNode", id: "check", label: "Changed" }] })).rejects.toThrow(/locked/);
    expect(await stub.applyOps({ clientOpId: "as-is", baseRevision: 3,
      ops: [{ op: "updateNode", id: "check", label: "Current edit" }] }, "user")).toMatchObject({ ok: true });
  });

  it("captures immutable content and permits review only through the owning account", async () => {
    const { projectId, stub } = await project();
    await stub.applyOps({ clientOpId: "current", baseRevision: 0, ops: MODEL_OPS }, "user");
    await stub.applyLifecycle({ clientOpId: "target", baseRevision: 1, ops: OPS, modelOps: MODEL_OPS });
    await expect(stub.createBaseline(1)).rejects.toThrow(/changed/);
    const baseline = await stub.createBaseline(2);
    const workspace = native(testEnv.WORKSPACE.getByName(crypto.randomUUID()));
    await expect(workspace.reviewThroughAccount("other-account", "lifecycle-test", projectId,
      baseline.id, "approved", "")).rejects.toThrow(/creating account/);
    await workspace.reviewThroughAccount("owner-account", "lifecycle-test", projectId,
      baseline.id, "approved", "Reviewed the captured evidence");
    await expect(workspace.reviewThroughAccount("owner-account", "lifecycle-test", projectId,
      baseline.id, "rejected", "Changed my mind")).rejects.toThrow(/already been reviewed/);
    const snapshot = await stub.snapshot();
    expect(snapshot.lifecycle?.baselines[0]?.review?.accountId).toBe("owner-account");
    expect(snapshot.lifecycle?.contentRevision).toBe(2);
    await stub.applyOps({ clientOpId: "changed-after-review", baseRevision: 4,
      ops: [{ op: "updateNode", id: "check", label: "Changed current process" }] }, "user");
    const changed = await stub.snapshot();
    expect(changed.lifecycle?.contentRevision).toBe(5);
    expect(changed.lifecycle?.baselines[0]?.content.asIs.nodes[1]?.label).toBe("Review request");
    await stub.applyLifecycle({ clientOpId: "target-after-review", baseRevision: 5, ops: [],
      modelOps: [{ op: "updateNode", id: "check", label: "New target" }] });
    expect((await stub.snapshot()).lifecycle?.baselines[0]?.content.toBe.nodes[1]?.label).toBe("Review request");
  });

  it("cannot approve incomplete content but retains an evidenced rejection", async () => {
    const { stub } = await project();
    const baseline = await stub.createBaseline(0);
    await expect(stub.reviewBaseline(baseline.id, "approved", "", "owner-account")).rejects.toThrow(/incomplete/);
    await expect(stub.reviewBaseline(baseline.id, "rejected", "", "owner-account")).rejects.toThrow(/not be empty/);
    await stub.reviewBaseline(baseline.id, "rejected", "Requirements and both models are missing", "owner-account");
    expect((await stub.snapshot()).lifecycle?.baselines[0]?.review?.decision).toBe("rejected");
  });

  it("simulates target/artifact proposals until approved and discards rejected proposals", async () => {
    const workspace = native(testEnv.WORKSPACE.getByName(crypto.randomUUID()));
    await workspace.bind("PROCESS", "lifecycle-test", "owner-account", "process://new?name=Review");
    const pending = await workspace.proposeAsAgent("PROCESS", {
      summary: "Define target and traceability", rationale: "Confirmed in interview",
      model: "toBe", ops: MODEL_OPS, lifecycleOps: OPS,
    }, "none");
    expect(pending.errors).toEqual([]);
    expect(pending.simulated.lifecycle.artifacts).toHaveLength(4);
    expect(pending.simulated.lifecycle.toBe.nodes).toHaveLength(3);
    expect(pending.committed.lifecycle?.artifacts).toEqual([]);
    expect(pending.committed.graph.nodes).toEqual([]);
    const other = native(testEnv.WORKSPACE.getByName(crypto.randomUUID()));
    await other.bind("PROCESS", "lifecycle-test", "owner-account", "process://new?name=Review");
    const accepted = await other.proposeAsAgent("PROCESS", {
      summary: "Define target and traceability", rationale: "Confirmed in interview",
      model: "toBe", ops: MODEL_OPS, lifecycleOps: OPS,
    }, "apply");
    expect(accepted.errors).toEqual([]);
    expect(accepted.committed.lifecycle?.artifacts).toHaveLength(4);
    expect(accepted.committed.graph.nodes).toEqual([]);
    const rejector = native(testEnv.WORKSPACE.getByName(crypto.randomUUID()));
    await rejector.bind("PROCESS", "lifecycle-test", "owner-account", "process://new?name=Review");
    const rejected = await rejector.proposeAsAgent("PROCESS", {
      summary: "Define target", rationale: "Interview", model: "toBe", ops: MODEL_OPS, lifecycleOps: OPS,
    }, "reject");
    expect(rejected.errors).toEqual([]);
    expect(rejected.after.lifecycle.artifacts).toEqual([]);
    expect(rejected.after.lifecycle.toBe.nodes).toEqual([]);
  });
});
