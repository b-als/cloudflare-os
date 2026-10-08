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
      stakeholders: [],
      interviewTargetStakeholderId: null,
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

  it("maintains a stakeholder register, interview target, and assigned questions", async () => {
    const { project } = await newProject(true);
    const elena = await project.upsertStakeholder(
      { name: "Elena Voss", role: "KYC lead", stance: "champion", userId: "user-elena" },
      "user",
    );
    expect(elena).toMatchObject({
      name: "Elena Voss", role: "KYC lead", stance: "champion", userId: "user-elena",
    });
    await project.setInterviewTarget(elena.stakeholderId, "user");
    const { questionId } = await project.raiseQuestion({
      text: "What triggers a KYC review?",
      nodeIds: ["review"],
      assigneeStakeholderId: elena.stakeholderId,
    }, "user");
    const snap = await project.snapshot();
    expect(snap.stakeholders).toEqual([elena]);
    expect(snap.interviewTargetStakeholderId).toBe(elena.stakeholderId);
    expect(snap.openQuestions).toMatchObject([{
      questionId, text: "What triggers a KYC review?", assigneeStakeholderId: elena.stakeholderId,
    }]);

    const updated = await project.upsertStakeholder(
      { stakeholderId: elena.stakeholderId, name: "Elena Voss", role: "Compliance", stance: "supporter" },
      "user",
    );
    expect(updated).toMatchObject({ role: "Compliance", stance: "supporter", userId: "user-elena" });

    await project.removeStakeholder(elena.stakeholderId, "user");
    const after = await project.snapshot();
    expect(after.stakeholders).toEqual([]);
    expect(after.interviewTargetStakeholderId).toBeNull();
    expect(after.openQuestions[0].assigneeStakeholderId).toBeUndefined();
    await expect(project.setInterviewTarget(elena.stakeholderId, "user")).rejects.toThrow(/does not exist/);
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

  it("persists step detail fields across stubs, and clears them with null", async () => {
    const { projectId, project } = await newProject(true);
    expect(await apply(project, 1, [{
      op: "updateNode", id: "review", description: "Check the order", owner: "Ops",
      inputs: ["Order"], outputs: ["Approval"], duration: { amount: 4, unit: "hours" },
      painPoints: "Slow",
    }])).toEqual({ ok: true, revision: 2 });
    const fresh = settle(rawProject(projectId));
    const review = (await fresh.snapshot()).graph.nodes.find((n) => n.id === "review")!;
    expect(review).toMatchObject({
      description: "Check the order", owner: "Ops", inputs: ["Order"], outputs: ["Approval"],
      duration: { amount: 4, unit: "hours" }, painPoints: "Slow",
    });

    expect(await apply(fresh, 2, [{ op: "updateNode", id: "review", inputs: null, duration: null }]))
      .toEqual({ ok: true, revision: 3 });
    const after = (await fresh.snapshot()).graph.nodes.find((n) => n.id === "review")!;
    expect(after.description).toBe("Check the order");
    expect(after.inputs).toBeUndefined();
    expect(after.duration).toBeUndefined();
  });

  it("lays out the flow left-to-right and broadcasts the moves", async () => {
    const { project } = await newProject(true);
    // Nudge a node out of its already-tidy position so layout has something to fix.
    expect(await apply(project, 1, [{ op: "moveNode", id: "review", x: 999, y: 999 }]))
      .toEqual({ ok: true, revision: 2 });
    const recorder = new Recorder();
    await project.subscribe(recorder, 2);
    const result = await project.layout();
    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(recorder.changes).toHaveLength(1));
    expect(recorder.changes[0].ops.every((op) => op.op === "moveNode")).toBe(true);
    // A second layout from the already-tidy graph is a no-op: same revision, nothing broadcast.
    const again = await project.layout();
    expect(again).toEqual({ ok: true, revision: (result as { revision: number }).revision });
    expect(recorder.changes).toHaveLength(1);
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
    expect(await ws.getAutoApprovableActions("PROCESS")).toEqual([
      { tag: "process.raiseQuestion", label: "Record a process question" },
      { tag: "process.upsertStakeholder", label: "Update the stakeholder register" },
      { tag: "process.removeStakeholder", label: "Remove a stakeholder" },
      { tag: "process.setInterviewTarget", label: "Set who to interview next" },
    ]);
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

  const AGENT_CHANGE = {
    summary: "Add intake step",
    rationale: "The buyer said every request starts with a form.",
    ops: [
      { op: "addLane", lane: { id: "buyer", label: "Buyer" } },
      { op: "addNode", node: { id: "intake", type: "userTask", label: "Submit request", laneId: "buyer" } },
    ] as GraphOp[],
  };

  it("simulates agent proposals, then applies them as unlocked decisions when approved", async () => {
    const ws = workspace();
    await ws.bind("PROCESS", DOMAIN, CREATOR, "process://new?name=Purchasing");
    const r = await ws.proposeAsAgent("PROCESS", AGENT_CHANGE, "apply", "Who approves over 10k?");
    expect(r.errors).toEqual([]);
    expect(r.submitted.map((s) => s.title)).toEqual([
      "Process map: Add intake step", "Process question: Who approves over 10k?",
    ]);
    expect(r.submitted[0].description).toContain("Add userTask **Submit request** in lane **Buyer**");
    expect(r.submitted[0].autoApprovable).toBeUndefined(); // graph changes always need manual review
    expect(r.submitted[1]).toMatchObject({
      autoApprovable: true, actionKind: { tag: "process.raiseQuestion", label: "Record a process question" },
    });
    expect(r.simulated.graph.nodes.map((n) => n.id)).toEqual(["intake"]);
    expect(r.simulated.decisions[0]).toMatchObject({ summary: "Add intake step", locked: false });
    expect(r.simulated.openQuestions.map((q) => q.text)).toEqual(["Who approves over 10k?"]);

    expect(r.committed.graph.nodes.map((n) => n.label)).toEqual(["Submit request"]);
    expect(r.committed.decisions).toMatchObject([{ summary: "Add intake step", locked: false, nodeIds: ["intake"] }]);
    expect(r.committed.openQuestions.map((q) => q.text)).toEqual(["Who approves over 10k?"]);
    expect(r.after.graph.nodes).toHaveLength(1);

    const edit = await ws.editThroughUi("PROCESS", {
      clientOpId: "c1", baseRevision: r.committed.graph.revision,
      ops: [{ op: "updateNode", id: "intake", label: "Raise request" }],
    });
    expect(edit.result.ok).toBe(true);
  });

  it("drops rejected proposals from the simulation without committing them", async () => {
    const ws = workspace();
    await ws.bind("PROCESS", DOMAIN, CREATOR, "process://new?name=Purchasing");
    const r = await ws.proposeAsAgent("PROCESS", AGENT_CHANGE, "reject");
    expect(r.simulated.graph.nodes).toHaveLength(1);
    expect(r.committed.graph.nodes).toEqual([]);
    expect(r.committed.decisions).toEqual([]);
    expect(r.after.graph.nodes).toEqual([]);
  });

  it("previews pending proposals as a diff against the committed graph", async () => {
    const ws = workspace();
    await ws.bind("PROCESS", DOMAIN, CREATOR, "process://new?name=Purchasing");
    await ws.proposeAsAgent("PROCESS", AGENT_CHANGE, "none", "Who approves over 10k?");
    const preview = await ws.previewPending("PROCESS");
    expect(preview.addedNodes.map((n) => n.id)).toEqual(["intake"]);
    expect(preview.addedEdges).toEqual([]);
    expect(preview.removedNodeIds).toEqual([]);
    expect(preview.changedNodeIds).toEqual([]);
    expect(preview.proposedQuestions.map((q) => q.text)).toEqual(["Who approves over 10k?"]);
  });

  it("refuses agent changes to locked elements unless they supersede the decision", async () => {
    const ws = workspace();
    await ws.bind("PROCESS", DOMAIN, CREATOR, "process://new?name=Purchasing");
    await ws.proposeAsAgent("PROCESS", AGENT_CHANGE, "apply");
    const frame = await ws.lockNode("PROCESS", "intake");
    const blocked = await ws.proposeAsAgent("PROCESS", {
      summary: "Rename", rationale: "r", ops: [{ op: "updateNode", id: "intake", label: "X" }],
    }, "none");
    expect(blocked.errors[0]).toMatch(/locked/);
    const allowed = await ws.proposeAsAgent("PROCESS", {
      summary: "Rename", rationale: "Lead asked", ops: [{ op: "updateNode", id: "intake", label: "X" }],
      supersedes: [frame.decisionId],
    }, "apply");
    expect(allowed.errors).toEqual([]);
    expect(allowed.committed.graph.nodes[0].label).toBe("X");
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

  it("simulates stakeholder register and assigned questions, then commits them when approved", async () => {
    const ws = workspace();
    await ws.bind("PROCESS", DOMAIN, CREATOR, "process://new?name=Purchasing");
    const r = await ws.proposeStakeholdersAsAgent("PROCESS", "apply", {
      upsert: { name: "Elena Voss", role: "KYC lead", stance: "champion", userId: "user-elena" },
      interviewTarget: "CREATED",
      question: { text: "What evidence do you need?", assigneeStakeholderId: "CREATED" },
    });
    expect(r.errors).toEqual([]);
    expect(r.submitted.map((s) => s.title)).toEqual([
      "Stakeholder: Elena Voss",
      "Interview next: Elena Voss",
      "Process question: What evidence do you need?",
    ]);
    expect(r.submitted.every((s) => s.autoApprovable)).toBe(true);
    expect(r.simulated.stakeholders).toMatchObject([{ name: "Elena Voss", role: "KYC lead" }]);
    expect(r.simulated.interviewTargetStakeholderId).toBe(r.simulated.stakeholders[0].stakeholderId);
    expect(r.simulated.openQuestions).toMatchObject([{
      text: "What evidence do you need?",
      assigneeStakeholderId: r.simulated.stakeholders[0].stakeholderId,
    }]);
    expect(r.committed.stakeholders).toMatchObject([{ name: "Elena Voss", userId: "user-elena" }]);
    expect(r.committed.interviewTargetStakeholderId).toBe(r.committed.stakeholders[0].stakeholderId);
    expect(r.committed.openQuestions).toMatchObject([{
      text: "What evidence do you need?",
      assigneeStakeholderId: r.committed.stakeholders[0].stakeholderId,
    }]);
  });
});
