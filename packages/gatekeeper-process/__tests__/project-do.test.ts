import { env, RpcTarget } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { domainName } from "../src/domain.js";
import { OP_LOG_LIMIT, type ProcessProjectDO } from "../src/project-do.js";
import type { GraphOp } from "../src/types.js";
import type { ApplyResult, ProjectChange, ProjectSnapshot } from "../src/ui-types.js";
import type { ProcessTestWorkspace } from "./worker.js";

const testEnv = env as unknown as {
  PROCESS_PROJECT: DurableObjectNamespace<ProcessProjectDO>;
  WORKSPACE: DurableObjectNamespace<ProcessTestWorkspace>;
};

const DOMAIN = "test-domain";
const CREATOR = "creator-account";

const SEED: GraphOp[] = [
  { op: "addLane", lane: { id: "sales", label: "Sales" } },
  { op: "addNode", node: { id: "start", type: "startEvent", label: "Start", laneId: "sales" } },
  { op: "addNode", node: { id: "review", type: "userTask", label: "Review", laneId: "sales" } },
  { op: "addEdge", edge: { id: "e1", source: "start", target: "review" } },
];

// expect().rejects probes properties, which on an RpcPromise spawn unobserved pipelined rejections.
function settle<T extends object>(stub: T): T {
  return new Proxy(stub, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => Promise.resolve(Reflect.apply(value, target, args));
    },
  });
}

function rawProject(projectId: string): DurableObjectStub<ProcessProjectDO> {
  return testEnv.PROCESS_PROJECT.getByName(domainName(DOMAIN, projectId));
}

async function newProject(seed = false) {
  const projectId = crypto.randomUUID();
  const project = settle(rawProject(projectId));
  await project.init(projectId, "Onboarding", CREATOR, DOMAIN);
  if (seed) expect(await apply(project, 0, SEED)).toEqual({ ok: true, revision: 1 });
  return { projectId, project };
}

let opCounter = 0;
function apply(
  project: DurableObjectStub<ProcessProjectDO>,
  baseRevision: number,
  ops: GraphOp[],
): Promise<ApplyResult> {
  return project.applyOps({ clientOpId: `op-${++opCounter}`, baseRevision, ops }, "user");
}

class Recorder extends RpcTarget {
  changes: ProjectChange[] = [];
  resets: ProjectSnapshot[] = [];
  changed(change: ProjectChange): void {
    this.changes.push(change);
  }
  reset(snapshot: ProjectSnapshot): void {
    this.resets.push(snapshot);
  }
}

describe("ProcessProjectDO", () => {
  it("initializes once and snapshots an empty project", async () => {
    const { projectId, project } = await newProject();
    expect(await project.snapshot()).toEqual({
      projectId,
      name: "Onboarding",
      graph: { revision: 0, lanes: [], nodes: [], edges: [] },
      decisions: [],
      openQuestions: [],
    });
    expect(await project.creatorAccountId()).toBe(CREATOR);
    await expect(project.init(projectId, "Again", CREATOR, DOMAIN)).rejects.toThrow(/already exists/);
  });

  it("persists ops across stubs and rejects stale or invalid batches with a snapshot", async () => {
    const { projectId, project } = await newProject(true);
    const fresh = settle(rawProject(projectId));
    expect((await fresh.snapshot()).graph.nodes.map((n) => n.id)).toEqual(["start", "review"]);

    expect(await apply(project, 1, [{ op: "updateNode", id: "review", label: "Check" }]))
      .toEqual({ ok: true, revision: 2 });
    const stale = await apply(project, 1, [{ op: "updateNode", id: "review", label: "Other" }]);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.snapshot.graph.revision).toBe(2);

    const invalid = await apply(project, 2, [{ op: "deleteNode", id: "ghost" }]);
    expect(invalid.ok).toBe(false);
    expect((await project.snapshot()).graph.revision).toBe(2);
  });

  it("locks decided elements except for moves, and unlocks them only by superseding", async () => {
    const { project } = await newProject(true);
    const decision = await project.recordDecision(
      { summary: "Review is manual", rationale: "Policy", nodeIds: ["review"], edgeIds: [] },
      "user",
    );
    expect((await apply(project, 2, [{ op: "updateNode", id: "review", label: "X" }])).ok).toBe(false);
    expect(await apply(project, 2, [{ op: "moveNode", id: "review", x: 10, y: 20 }]))
      .toEqual({ ok: true, revision: 3 });

    const next = await project.recordDecision(
      { summary: "Only start is fixed", rationale: "Changed", nodeIds: ["start"], edgeIds: [],
        supersedes: [decision.decisionId] },
      "user",
    );
    const { decisions } = await project.snapshot();
    expect(decisions.find((d) => d.decisionId === decision.decisionId))
      .toMatchObject({ status: "superseded", supersededBy: next.decisionId });
    expect((await apply(project, 4, [{ op: "updateNode", id: "review", label: "X" }])).ok).toBe(true);
    await expect(project.recordDecision(
      { summary: "s", rationale: "r", nodeIds: [], edgeIds: [], supersedes: [decision.decisionId] },
      "user",
    )).rejects.toThrow(/not an active decision/);
  });

  it("raises and resolves questions", async () => {
    const { project } = await newProject(true);
    const { questionId } = await project.raiseQuestion({ text: "Who approves?", nodeIds: ["review"] }, "user");
    expect((await project.snapshot()).openQuestions.map((q) => q.questionId)).toEqual([questionId]);
    await project.resolveQuestion(questionId, "Finance", "user");
    expect((await project.snapshot()).openQuestions).toEqual([]);
    await expect(project.resolveQuestion(questionId, "Again", "user")).rejects.toThrow(/already resolved/);
  });

  it("claims a project for one workspace only", async () => {
    const { project } = await newProject();
    await project.claim("workspace-a");
    await project.claim("workspace-a");
    await expect(project.claim("workspace-b")).rejects.toThrow(/already linked/);
    await expect(settle(rawProject(crypto.randomUUID())).claim("workspace-a")).rejects.toThrow(/not found/);
  });

  it("replays history to subscribers, then streams live changes until disposed", async () => {
    const { project } = await newProject(true);
    const recorder = new Recorder();
    const subscription = await rawProject((await project.snapshot()).projectId).subscribe(recorder, 0);
    await vi.waitFor(() => expect(recorder.changes.map((c) => c.revision)).toEqual([1]));

    await apply(project, 1, [{ op: "moveNode", id: "start", x: 5, y: 5 }]);
    await project.raiseQuestion({ text: "?" }, "user");
    await vi.waitFor(() => expect(recorder.changes.map((c) => c.revision)).toEqual([1, 2, 3]));
    expect(recorder.changes[2].questionRaised?.text).toBe("?");

    subscription[Symbol.dispose]();
    await apply(project, 3, [{ op: "moveNode", id: "start", x: 6, y: 6 }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recorder.changes).toHaveLength(3);
  });

  it("bounds the op log and resets subscribers whose history was trimmed", async () => {
    const { projectId } = await newProject(true);
    const project = rawProject(projectId);
    const extra = 10;
    await runInDurableObject(project, async (instance) => {
      for (let revision = 1; revision < OP_LOG_LIMIT + extra; revision++) {
        const result = instance.applyOps({
          clientOpId: `move-${revision}`,
          baseRevision: revision,
          ops: [{ op: "moveNode", id: "start", x: revision, y: 0 }],
        }, "user");
        expect(result.ok).toBe(true);
      }
    });
    await runInDurableObject(project, (_instance, state) => {
      const stats = state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM ops_log").one();
      expect(stats.n).toBe(OP_LOG_LIMIT);
    });
    const recorder = new Recorder();
    await project.subscribe(recorder, 0);
    await vi.waitFor(() => expect(recorder.resets).toHaveLength(1));
    expect(recorder.changes).toEqual([]);
    expect(recorder.resets[0].graph.revision).toBe(OP_LOG_LIMIT + extra);
  });
});

describe("ProcessProjectGatekeeper", () => {
  function workspace() {
    return settle(testEnv.WORKSPACE.getByName(crypto.randomUUID()));
  }

  it("creates a project on first use of a process://new binding and edits it through startUi", async () => {
    const ws = workspace();
    await ws.bind("PROCESS", DOMAIN, CREATOR, "process://new?name=Invoices");
    expect(await ws.describe("PROCESS")).toMatchObject({ title: "Invoices", tsType: "ProcessProject" });
    const { html, result, snapshot } = await ws.editThroughUi("PROCESS", {
      clientOpId: "c1", baseRevision: 0, ops: [SEED[0]],
    });
    expect(html).toContain("<html");
    expect(result).toEqual({ ok: true, revision: 1 });
    expect(snapshot.graph.lanes).toEqual([{ id: "sales", label: "Sales" }]);
  });

  it("authorizes every session read as an observation before returning data", async () => {
    const ws = workspace();
    await ws.bind("PROCESS", DOMAIN, CREATOR, "process://new?name=Invoices");
    const ok = await ws.read("PROCESS");
    expect(ok.events).toEqual([
      "authorize:Read process project context", "returned:context",
      "authorize:Read process graph", "returned:graph",
    ]);
    expect(ok.context?.name).toBe("Invoices");
    const denied = await ws.read("PROCESS", true);
    expect(denied.events).toEqual(["authorize:Read process project context"]);
    expect(denied.error).toMatch(/observation rejected/);
  });

  it("does not yet accept agent changes", async () => {
    const ws = workspace();
    await ws.bind("PROCESS", DOMAIN, CREATOR, "process://new");
    const errors = await ws.proposeAsAgent("PROCESS");
    expect(errors).toHaveLength(2);
    for (const error of errors) expect(error).toMatch(/Not available yet/);
  });

  it("lets only the creator link an existing project, to a single workspace", async () => {
    const first = workspace();
    await first.bind("PROCESS", DOMAIN, CREATOR, "process://new?name=Invoices");
    const { snapshot } = await first.editThroughUi("PROCESS", {
      clientOpId: "c1", baseRevision: 0, ops: [SEED[0]],
    });
    const url = `process://project/${snapshot.projectId}`;

    await expect(workspace().bind("PROCESS", DOMAIN, "someone-else", url)).rejects.toThrow(/do not have access/);
    const second = workspace();
    await second.bind("PROCESS", DOMAIN, CREATOR, url);
    await expect(second.describe("PROCESS")).rejects.toThrow(/already linked/);
  });

  it("accepts observers from the same deployment only", async () => {
    const ws = workspace();
    await ws.bind("PROCESS", DOMAIN, CREATOR, "process://new");
    await ws.observe("PROCESS", DOMAIN);
    await expect(ws.observe("PROCESS", "other-domain")).rejects.toThrow(/another deployment/);
  });
});
