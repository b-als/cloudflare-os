import { env, RpcTarget } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { domainName } from "../src/domain.js";
import { CHANGE_LOG_LIMIT, type ProcessProjectDO } from "../src/project-do.js";
import type { ChangeSet, GraphOp } from "../src/types.js";
import type { ApplyResult, ProjectChange, ProjectSnapshot } from "../src/ui-types.js";
import type { ProcessTestWorkspace } from "./worker.js";

const testEnv = env as unknown as {
  PROCESS_PROJECT: DurableObjectNamespace<ProcessProjectDO>;
  WORKSPACE: DurableObjectNamespace<ProcessTestWorkspace>;
};

const DOMAIN = "test-domain";
const CREATOR = "creator-account";

const FIRST_DRAFT: ChangeSet = {
  summary: "First draft of invoice approval",
  rationale: "They said invoices arrive by email, Finance checks them, and a manager approves.",
  ops: [
    { op: "addLane", lane: { id: "finance", label: "Finance" } },
    { op: "addLane", lane: { id: "manager", label: "Manager" } },
    { op: "addNode", node: { id: "start", type: "startEvent", label: "Invoice arrives", laneId: "finance" } },
    { op: "addNode", node: { id: "check", type: "userTask", label: "Check invoice", laneId: "finance" } },
    { op: "addNode", node: { id: "approve", type: "userTask", label: "Approve", laneId: "manager",
      description: "Inferred: a manager signs off. Confirm who." } },
    { op: "addNode", node: { id: "end", type: "endEvent", label: "Paid", laneId: "finance" } },
    { op: "addEdge", edge: { id: "f1", source: "start", target: "check" } },
    { op: "addEdge", edge: { id: "f2", source: "check", target: "approve" } },
    { op: "addEdge", edge: { id: "f3", source: "approve", target: "end" } },
  ],
};

async function workspace() {
  const ws = testEnv.WORKSPACE.getByName(crypto.randomUUID());
  await ws.bind("PROCESS_PROJECT", DOMAIN, CREATOR, "process://new?name=Invoice approval");
  return ws;
}

let batches = 0;
const batch = (baseRevision: number, ops: GraphOp[]) => ({ clientOpId: `edit-${++batches}`, baseRevision, ops });

describe("the conversation drafting the map", () => {
  it("previews a first draft whole, lanes included, before the person accepts it", async () => {
    const ws = await workspace();
    const { receipt } = await ws.propose("PROCESS_PROJECT", FIRST_DRAFT);
    expect(receipt?.graph.nodes).toHaveLength(4);

    const preview = await ws.preview("PROCESS_PROJECT");
    expect(preview.addedLanes.map((lane) => lane.label)).toEqual(["Finance", "Manager"]);
    expect(preview.addedNodes.map((node) => node.id).toSorted()).toEqual(["approve", "check", "end", "start"]);
    expect(preview.addedEdges).toHaveLength(3);
    expect((await ws.snapshot("PROCESS_PROJECT")).graph.nodes).toEqual([]);
  });

  it("lays the draft out in flow order, so it reads left to right without tidying", async () => {
    const ws = await workspace();
    const { receipt } = await ws.propose("PROCESS_PROJECT", FIRST_DRAFT);
    const x = (id: string) => receipt!.graph.nodes.find((node) => node.id === id)!.x;
    expect(x("start")).toBeLessThan(x("check"));
    expect(x("check")).toBeLessThan(x("approve"));
    expect(x("approve")).toBeLessThan(x("end"));
  });

  it("asks the person, and waits for their answer, before anything is written", async () => {
    const ws = await workspace();
    await ws.propose("PROCESS_PROJECT", FIRST_DRAFT);
    const [card] = await ws.getSubmitted();
    expect(card.title).toBe("Process map: First draft of invoice approval");
    expect(card.awaitDecision).toBe(true);
    expect(card.descriptionIsComplete).toBe(true);
    expect(await ws.autoApprovable("PROCESS_PROJECT")).toBe(0);
  });

  it("shows the person every edit in plain words, and the decision it records, without JSON", async () => {
    const ws = await workspace();
    await ws.propose("PROCESS_PROJECT", FIRST_DRAFT);
    const [card] = await ws.getSubmitted();
    expect(card.fields).toEqual([
      { label: "Edits", kind: "list", items: [
        "Add lane “Finance” [finance]",
        "Add lane “Manager” [manager]",
        "Add start “Invoice arrives” [start] to “Finance” [finance]",
        "Add step “Check invoice” [check] to “Finance” [finance]",
        "Add step “Approve” [approve] to “Manager” [manager] — description: “Inferred: a manager signs off. Confirm who.”",
        "Add end “Paid” [end] to “Finance” [finance]",
        "Connect “Invoice arrives” [start] → “Check invoice” [check] [f1]",
        "Connect “Check invoice” [check] → “Approve” [approve] [f2]",
        "Connect “Approve” [approve] → “Paid” [end] [f3]",
      ] },
      { label: "Decision it records", kind: "text", value: `${FIRST_DRAFT.summary}\n\n${FIRST_DRAFT.rationale}` },
    ]);
  });

  it("writes an accepted change and remembers it as a decision with its rationale", async () => {
    const ws = await workspace();
    await ws.propose("PROCESS_PROJECT", FIRST_DRAFT);
    expect(await ws.decide("PROCESS_PROJECT", "apply")).toEqual({});

    const snapshot = await ws.snapshot("PROCESS_PROJECT");
    expect(snapshot.graph.nodes).toHaveLength(4);
    expect(snapshot.decisions).toHaveLength(1);
    expect(snapshot.decisions[0]).toMatchObject({
      summary: "First draft of invoice approval",
      rationale: FIRST_DRAFT.rationale,
    });
    expect(snapshot.decisions[0].nodeIds.toSorted()).toEqual(["approve", "check", "end", "start"]);
    const preview = await ws.preview("PROCESS_PROJECT");
    expect(preview.addedNodes).toEqual([]);

    const context = await ws.context("PROCESS_PROJECT");
    expect(context.decisions.map((d) => d.summary)).toEqual(["First draft of invoice approval"]);
  });

  it("writes nothing when the person rejects a change", async () => {
    const ws = await workspace();
    await ws.propose("PROCESS_PROJECT", FIRST_DRAFT);
    expect(await ws.decide("PROCESS_PROJECT", "reject")).toEqual({});
    const snapshot = await ws.snapshot("PROCESS_PROJECT");
    expect(snapshot.graph.nodes).toEqual([]);
    expect(snapshot.decisions).toEqual([]);
    expect((await ws.preview("PROCESS_PROJECT")).addedNodes).toEqual([]);
  });

  it("lets the agent build on its own pending draft, and steer by coverage", async () => {
    const ws = await workspace();
    await ws.propose("PROCESS_PROJECT", FIRST_DRAFT);
    const context = await ws.context("PROCESS_PROJECT");
    expect(context.graph.nodes).toHaveLength(4);
    expect(context.coverage.find((item) => item.key === "happyPath")?.done).toBe(true);
    expect(context.coverage.find((item) => item.key === "exceptions")?.done).toBe(false);
    expect(await ws.getObservations()).toContain("Read the process map");

    const { error } = await ws.propose("PROCESS_PROJECT", {
      summary: "Add the rejection path",
      rationale: "A manager can send an invoice back.",
      ops: [
        { op: "addNode", node: { id: "rejected", type: "endEvent", label: "Sent back", laneId: "manager" } },
        { op: "addEdge", edge: { id: "f4", source: "approve", target: "rejected", label: "Rejected" } },
      ],
    });
    expect(error).toBeUndefined();
  });

  it("refuses an invalid change up front, without bothering the person", async () => {
    const ws = await workspace();
    const { error } = await ws.propose("PROCESS_PROJECT", {
      summary: "Connect to nowhere", rationale: "Testing.",
      ops: [{ op: "addEdge", edge: { id: "x", source: "missing", target: "also-missing" } }],
    });
    expect(error).toMatch(/does not exist/);
    expect(await ws.getSubmitted()).toEqual([]);
  });

  it("reports a proposal that someone's edit has overtaken, and won't apply it", async () => {
    const ws = await workspace();
    await ws.propose("PROCESS_PROJECT", FIRST_DRAFT);
    await ws.decide("PROCESS_PROJECT", "apply");
    await ws.propose("PROCESS_PROJECT", {
      summary: "Rename the check", rationale: "Finance calls it matching.",
      ops: [{ op: "updateNode", id: "check", label: "Match invoice to PO" }],
    });
    const { graph } = await ws.snapshot("PROCESS_PROJECT");
    expect(await ws.edit("PROCESS_PROJECT", batch(graph.revision, [{ op: "deleteNode", id: "check" }]))).toMatchObject({ ok: true });

    const preview = await ws.preview("PROCESS_PROJECT");
    expect(preview.conflicts?.[0]).toMatch(/"Rename the check" no longer applies/);
    expect((await ws.decide("PROCESS_PROJECT", "apply")).error).toMatch(/no longer applies/);
  });
});

describe("people editing the map directly", () => {
  it("lets two people edit different steps from the same revision, but not the same step", async () => {
    const ws = await workspace();
    await ws.propose("PROCESS_PROJECT", FIRST_DRAFT);
    await ws.decide("PROCESS_PROJECT", "apply");
    const { revision } = (await ws.snapshot("PROCESS_PROJECT")).graph;

    const first = await ws.edit("PROCESS_PROJECT", batch(revision, [{ op: "updateNode", id: "check", label: "Check it" }]));
    const other = await ws.edit("PROCESS_PROJECT", batch(revision, [{ op: "updateNode", id: "approve", label: "Sign off" }]));
    const clash = await ws.edit("PROCESS_PROJECT", batch(revision, [{ op: "updateNode", id: "check", label: "Verify" }]));
    expect(first).toMatchObject({ ok: true });
    expect(other).toMatchObject({ ok: true });
    expect(clash).toMatchObject({ ok: false, reason: "Someone else changed this part of the map first." });
    if (!clash.ok) expect(clash.snapshot.graph.nodes.find((n) => n.id === "check")?.label).toBe("Check it");
  });

  it("rejects an edit against a revision that never existed", async () => {
    const ws = await workspace();
    const result: ApplyResult = await ws.edit("PROCESS_PROJECT", batch(99, [{ op: "addLane", lane: { id: "a", label: "A" } }]));
    expect(result).toMatchObject({ ok: false });
  });
});

describe("the project", () => {
  it("is named and described for the workspace", async () => {
    const ws = await workspace();
    expect(await ws.describe("PROCESS_PROJECT")).toMatchObject({ title: "Invoice approval", tsType: "ProcessProject" });
  });

  it("belongs to the one workspace that claimed it", async () => {
    const ws = await workspace();
    await ws.snapshot("PROCESS_PROJECT");
    const projectId = await ws.projectId("PROCESS_PROJECT");
    const other = testEnv.WORKSPACE.getByName(crypto.randomUUID());
    await other.bind("PROCESS_PROJECT", DOMAIN, CREATOR, `process://project/${projectId}`);
    await expect(Promise.resolve(other.snapshot("PROCESS_PROJECT"))).rejects.toThrow(/another workspace/);
  });

  it("only admits collaborators from the same deployment", async () => {
    const ws = await workspace();
    await expect(Promise.resolve(ws.observe("PROCESS_PROJECT", DOMAIN))).resolves.toBeUndefined();
    await expect(Promise.resolve(ws.observe("PROCESS_PROJECT", "elsewhere"))).rejects.toThrow(/another deployment/);
  });
});

class Recorder extends RpcTarget {
  changes: ProjectChange[] = [];
  resets: ProjectSnapshot[] = [];
  changed(change: ProjectChange) { this.changes.push(change); }
  reset(snapshot: ProjectSnapshot) { this.resets.push(snapshot); }
}

describe("live updates", () => {
  async function project() {
    const projectId = crypto.randomUUID();
    const stub = testEnv.PROCESS_PROJECT.getByName(domainName(DOMAIN, projectId));
    await stub.claim("workspace", { projectId, name: "Live", creatorAccountId: CREATOR, sharingDomain: DOMAIN });
    return stub;
  }

  it("catches an open map up on what it missed, then streams new changes", async () => {
    const stub = await project();
    await stub.applyOps(batch(0, [{ op: "addLane", lane: { id: "a", label: "A" } }]), "user");
    const recorder = new Recorder();
    using _subscription = await stub.subscribe(recorder, 0);
    await stub.applyOps(batch(1, [{ op: "addLane", lane: { id: "b", label: "B" } }]), "user");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(recorder.changes.map((c) => c.revision)).toEqual([1, 2]);
    expect(recorder.resets).toEqual([]);
  });

  it("sends a fresh snapshot when the changes it missed are no longer kept", async () => {
    const stub = await project();
    await stub.applyOps(batch(0, [{ op: "addLane", lane: { id: "a", label: "A" } }]), "user");
    for (let revision = 1; revision <= CHANGE_LOG_LIMIT + 1; revision++) {
      await stub.applyOps(batch(revision, [{ op: "renameLane", id: "a", label: `A${revision}` }]), "user");
    }
    const recorder = new Recorder();
    using _subscription = await stub.subscribe(recorder, 0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(recorder.resets).toHaveLength(1);
    expect(recorder.changes).toEqual([]);
  });
});

describe("projects from the retired ten-stage model", () => {
  it("keep their map and decisions, and nothing else", async () => {
    const projectId = crypto.randomUUID();
    const stub = testEnv.PROCESS_PROJECT.getByName(domainName(DOMAIN, projectId));
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec(`CREATE TABLE meta (id INTEGER PRIMARY KEY, project_id TEXT, sharing_domain TEXT, name TEXT,
        creator_account_id TEXT, claimed_by TEXT, created_at INTEGER, updated_at INTEGER, revision INTEGER)`);
      sql.exec(`INSERT INTO meta VALUES (1, ?, ?, 'Supplier offboarding', ?, 'ws-old', 1, 2, 7)`, projectId, DOMAIN, CREATOR);
      sql.exec("CREATE TABLE lanes (id TEXT, label TEXT, position INTEGER)");
      sql.exec("INSERT INTO lanes VALUES ('ops', 'Operations', 0)");
      sql.exec(`CREATE TABLE nodes (id TEXT, type TEXT, label TEXT, lane_id TEXT, x REAL, y REAL, description TEXT,
        owner TEXT, system TEXT, inputs TEXT, outputs TEXT, duration_amount REAL, duration_unit TEXT, pain_points TEXT,
        modified_revision INTEGER)`);
      sql.exec(`INSERT INTO nodes VALUES ('notify', 'userTask', 'Notify supplier', 'ops', 80, 60, NULL, 'Procurement',
        NULL, '["Contract"]', NULL, 2, 'days', 'Slow', 3)`);
      sql.exec("CREATE TABLE edges (id TEXT, source TEXT, target TEXT, label TEXT, modified_revision INTEGER)");
      sql.exec(`CREATE TABLE decisions (model TEXT, decision_id TEXT, summary TEXT, rationale TEXT, node_ids TEXT,
        edge_ids TEXT, status TEXT, superseded_by TEXT, decided_at INTEGER, source TEXT, locked INTEGER)`);
      sql.exec(`INSERT INTO decisions VALUES ('asIs', 'd1', 'Notify first', 'Legal requires it', '["notify"]', '[]',
        'active', NULL, 5, 'agent', 0)`);
      sql.exec(`INSERT INTO decisions VALUES ('toBe', 'd2', 'Future idea', 'Later', '[]', '[]', 'active', NULL, 6, 'agent', 0)`);
      sql.exec("CREATE TABLE stakeholders (stakeholder_id TEXT)");
    });

    const snapshot = await stub.snapshot();
    expect(snapshot.name).toBe("Supplier offboarding");
    expect(snapshot.graph.revision).toBe(7);
    expect(snapshot.graph.lanes).toEqual([{ id: "ops", label: "Operations" }]);
    expect(snapshot.graph.nodes).toEqual([{
      id: "notify", type: "userTask", label: "Notify supplier", laneId: "ops", x: 80, y: 60,
      owner: "Procurement", inputs: ["Contract"], duration: { amount: 2, unit: "days" }, painPoints: "Slow",
    }]);
    expect(snapshot.decisions.map((d) => d.summary)).toEqual(["Notify first"]);
    await expect(Promise.resolve(stub.claim("ws-old"))).resolves.toBeUndefined();
  });
});
