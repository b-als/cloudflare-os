import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { domainName } from "../src/domain.js";
import type { AccountProjectsDO } from "../src/account-projects-do.js";
import { OP_LOG_LIMIT, type ProcessProjectDO } from "../src/project-do.js";
import { ProcessStudioApiImpl } from "../src/process.js";
import type { GraphOp } from "../src/types.js";
import type { ApplyResult, OpBatch } from "../src/ui-types.js";

const testEnv = env as unknown as {
  PROCESS_PROJECT: DurableObjectNamespace<ProcessProjectDO>;
  ACCOUNT_PROJECTS: DurableObjectNamespace<AccountProjectsDO>;
};

const DOMAIN = "test-domain";
const OWNER = "owner-account";
const EDITOR = "editor-account";
const VIEWER = "viewer-account";

const SEED: GraphOp[] = [
  { op: "addLane", lane: { id: "sales", label: "Sales" } },
  { op: "addNode", node: { id: "start", type: "startEvent", label: "Start", laneId: "sales" } },
  { op: "addNode", node: { id: "review", type: "userTask", label: "Review", laneId: "sales" } },
  { op: "addEdge", edge: { id: "e1", source: "start", target: "review" } },
];

function rawProjectStub(projectId: string): DurableObjectStub<ProcessProjectDO> {
  return testEnv.PROCESS_PROJECT.getByName(domainName(DOMAIN, projectId));
}

// expect().rejects probes properties, which on an RpcPromise spawn unobserved pipelined rejections.
function projectStub(projectId: string): DurableObjectStub<ProcessProjectDO> {
  const stub = rawProjectStub(projectId);
  return new Proxy(stub, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => Promise.resolve(Reflect.apply(value, target, args));
    },
  });
}

async function newProject(): Promise<{ projectId: string; project: DurableObjectStub<ProcessProjectDO> }> {
  const projectId = crypto.randomUUID();
  const project = projectStub(projectId);
  await project.init(projectId, "Onboarding", OWNER, DOMAIN);
  return { projectId, project };
}

async function seeded() {
  const created = await newProject();
  expect(await apply(created.project, OWNER, 0, SEED)).toEqual({ ok: true, revision: 1 });
  await created.project.addMember(EDITOR, "editor");
  await created.project.addMember(VIEWER, "viewer");
  return created;
}

let opCounter = 0;
function apply(
  project: DurableObjectStub<ProcessProjectDO>,
  accountId: string,
  baseRevision: number,
  ops: GraphOp[],
): Promise<ApplyResult> {
  const batch: OpBatch = { clientOpId: `op-${++opCounter}`, baseRevision, ops };
  return project.applyOps(accountId, batch);
}

function studio(accountId: string): ProcessStudioApiImpl {
  return new ProcessStudioApiImpl({
    sharingDomain: DOMAIN,
    accountId,
    projects: testEnv.PROCESS_PROJECT,
    indexes: testEnv.ACCOUNT_PROJECTS,
  });
}

describe("ProcessProjectDO", () => {
  it("initializes once and snapshots an empty project for the owner", async () => {
    const { projectId, project } = await newProject();
    const snapshot = await project.snapshot(OWNER);
    expect(snapshot).toEqual({
      projectId,
      name: "Onboarding",
      role: "owner",
      graph: { revision: 0, lanes: [], nodes: [], edges: [] },
      decisions: [],
      openQuestions: [],
    });
    await expect(project.init(projectId, "Again", "someone", DOMAIN)).rejects.toThrow(/already exists/);
  });

  it("persists applied ops and increments the revision", async () => {
    const { projectId, project } = await newProject();
    expect(await apply(project, OWNER, 0, SEED)).toEqual({ ok: true, revision: 1 });
    expect(await apply(project, OWNER, 1, [{ op: "renameLane", id: "sales", label: "Sales team" }]))
      .toEqual({ ok: true, revision: 2 });

    const fresh = await projectStub(projectId).snapshot(OWNER);
    expect(fresh.graph.revision).toBe(2);
    expect(fresh.graph.lanes).toEqual([{ id: "sales", label: "Sales team" }]);
    expect(fresh.graph.nodes.map((node) => [node.id, node.x, node.y])).toEqual([
      ["start", 80, 60],
      ["review", 280, 60],
    ]);
    expect(fresh.graph.edges).toEqual([{ id: "e1", source: "start", target: "review" }]);
  });

  it("rejects stale batches that touch changed elements, returning a fresh snapshot", async () => {
    const { project } = await seeded();
    expect(await apply(project, OWNER, 1, [{ op: "updateNode", id: "review", label: "A" }]))
      .toEqual({ ok: true, revision: 2 });

    const stale = await apply(project, EDITOR, 1, [{ op: "updateNode", id: "review", label: "B" }]);
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.reason).toMatch(/Node "review" changed at revision 2, after base revision 1/);
    expect(stale.snapshot.graph.revision).toBe(2);
    expect(stale.snapshot.role).toBe("editor");
    expect(stale.snapshot.graph.nodes.find((node) => node.id === "review")?.label).toBe("A");

    const cascaded = await apply(project, EDITOR, 1, [{ op: "deleteNode", id: "start" }]);
    expect(cascaded).toEqual({ ok: true, revision: 3 });
  });

  it("accepts stale batches that touch only unchanged elements", async () => {
    const { project } = await seeded();
    await apply(project, OWNER, 1, [{ op: "moveNode", id: "review", x: 500, y: 60 }]);
    expect(await apply(project, EDITOR, 1, [{ op: "updateNode", id: "start", label: "Begin" }]))
      .toEqual({ ok: true, revision: 3 });
  });

  it("rejects unknown base revisions and invalid ops without committing", async () => {
    const { project } = await seeded();
    const future = await apply(project, OWNER, 9, [{ op: "moveNode", id: "start", x: 0, y: 0 }]);
    expect(future).toMatchObject({ ok: false, reason: expect.stringMatching(/not a known revision/) });
    const invalid = await apply(project, OWNER, 1, [
      { op: "moveNode", id: "start", x: 0, y: 0 },
      { op: "deleteNode", id: "ghost" },
    ]);
    expect(invalid).toMatchObject({ ok: false, reason: 'Op 1: Node "ghost" does not exist.' });
    const empty = await apply(project, OWNER, 1, []);
    expect(empty).toMatchObject({ ok: false });
    expect((await project.snapshot(OWNER)).graph.revision).toBe(1);
  });

  it("lets viewers read but not edit", async () => {
    const { project } = await seeded();
    expect((await project.snapshot(VIEWER)).role).toBe("viewer");
    await expect(apply(project, VIEWER, 1, [{ op: "moveNode", id: "start", x: 0, y: 0 }]))
      .rejects.toThrow(/Viewers cannot edit/);
    await expect(project.recordDecision(VIEWER, {
      summary: "x", rationale: "", nodeIds: [], edgeIds: [],
    })).rejects.toThrow(/Viewers cannot edit/);
  });

  it("rejects non-members", async () => {
    const { project } = await seeded();
    await expect(project.snapshot("stranger")).rejects.toThrow(/not found or you do not have access/);
    await expect(apply(project, "stranger", 1, [{ op: "moveNode", id: "start", x: 0, y: 0 }]))
      .rejects.toThrow(/not found or you do not have access/);
    expect(await project.memberRole("stranger")).toBeNull();
    expect(await projectStub("missing").memberRole(OWNER)).toBeNull();
  });

  it("blocks editors on locked elements but allows moves; owners may edit locks", async () => {
    const { project } = await seeded();
    await project.recordDecision(OWNER, {
      summary: "Review is mandatory", rationale: "Compliance", nodeIds: ["review"], edgeIds: ["e1"],
    });
    const blocked = await apply(project, EDITOR, 2, [{ op: "updateNode", id: "review", label: "Skip" }]);
    expect(blocked).toMatchObject({ ok: false, reason: expect.stringMatching(/Node "review" is locked/) });
    const cascade = await apply(project, EDITOR, 2, [{ op: "deleteNode", id: "start" }]);
    expect(cascade).toMatchObject({ ok: false, reason: expect.stringMatching(/Edge "e1" is locked/) });
    expect(await apply(project, EDITOR, 2, [{ op: "moveNode", id: "review", x: 400, y: 60 }]))
      .toEqual({ ok: true, revision: 3 });
    expect(await apply(project, OWNER, 3, [{ op: "updateNode", id: "review", label: "Owner edit" }]))
      .toEqual({ ok: true, revision: 4 });
  });

  it("supersedes decisions and moves locks to the new decision", async () => {
    const { project } = await seeded();
    const first = await project.recordDecision(EDITOR, {
      summary: "Lock review", rationale: "Agreed in workshop", nodeIds: ["review"], edgeIds: [],
    });
    expect(first).toMatchObject({ status: "active", nodeIds: ["review"] });
    const second = await project.recordDecision(OWNER, {
      summary: "Lock start instead", rationale: "Review may change", nodeIds: ["start", "start"],
      edgeIds: [], supersedes: [first.decisionId],
    });
    expect(second.nodeIds).toEqual(["start"]);

    const snapshot = await project.snapshot(OWNER);
    expect(snapshot.graph.revision).toBe(3);
    expect(snapshot.decisions.map((d) => [d.decisionId, d.status, d.supersededBy])).toEqual([
      [second.decisionId, "active", undefined],
      [first.decisionId, "superseded", second.decisionId],
    ]);

    expect(await apply(project, EDITOR, 3, [{ op: "updateNode", id: "review", label: "Free" }]))
      .toEqual({ ok: true, revision: 4 });
    expect(await apply(project, EDITOR, 4, [{ op: "updateNode", id: "start", label: "Nope" }]))
      .toMatchObject({ ok: false });

    await expect(project.recordDecision(OWNER, {
      summary: "Again", rationale: "", nodeIds: [], edgeIds: [], supersedes: [first.decisionId],
    })).rejects.toThrow(/not an active decision/);
    await expect(project.recordDecision(OWNER, {
      summary: "Ghost", rationale: "", nodeIds: ["ghost"], edgeIds: [],
    })).rejects.toThrow(/Node "ghost" does not exist/);
    await expect(project.recordDecision(OWNER, {
      summary: "  ", rationale: "", nodeIds: [], edgeIds: [],
    })).rejects.toThrow(/Summary must not be empty/);
  });

  it("raises and resolves questions", async () => {
    const { project } = await seeded();
    const { questionId } = await project.raiseQuestion(EDITOR, {
      text: "Who approves refunds?", nodeIds: ["review"],
    });
    const open = (await project.snapshot(VIEWER)).openQuestions;
    expect(open).toEqual([
      { questionId, text: "Who approves refunds?", nodeIds: ["review"], raisedAt: expect.any(Number) },
    ]);
    await expect(project.raiseQuestion(EDITOR, { text: "?", nodeIds: ["ghost"] }))
      .rejects.toThrow(/does not exist/);
    await expect(project.raiseQuestion(VIEWER, { text: "?" })).rejects.toThrow(/Viewers/);

    await project.resolveQuestion(OWNER, questionId, "The finance lead.");
    expect((await project.snapshot(OWNER)).openQuestions).toEqual([]);
    await expect(project.resolveQuestion(OWNER, questionId, "Again")).rejects.toThrow(/already resolved/);
    await expect(project.resolveQuestion(OWNER, "nope", "x")).rejects.toThrow(/does not exist/);
  });

  it("records every commit in a bounded op log", async () => {
    const { projectId } = await seeded();
    const project = rawProjectStub(projectId);
    const extra = 10;
    await runInDurableObject(project, async (instance) => {
      for (let revision = 1; revision < OP_LOG_LIMIT + extra; revision++) {
        const result = await instance.applyOps(OWNER, {
          clientOpId: `move-${revision}`,
          baseRevision: revision,
          ops: [{ op: "moveNode", id: "start", x: revision, y: 0 }],
        });
        expect(result.ok).toBe(true);
      }
    });
    const lastRevision = OP_LOG_LIMIT + extra;
    await runInDurableObject(project, (_instance, state) => {
      const stats = state.storage.sql.exec<{ n: number; lo: number; hi: number }>(
        "SELECT COUNT(*) AS n, MIN(revision) AS lo, MAX(revision) AS hi FROM ops_log",
      ).one();
      expect(stats).toEqual({ n: OP_LOG_LIMIT, lo: lastRevision - OP_LOG_LIMIT + 1, hi: lastRevision });
      const last = state.storage.sql.exec<{ client_op_id: string; actor_account_id: string; source: string }>(
        "SELECT client_op_id, actor_account_id, source FROM ops_log WHERE revision = ?", lastRevision,
      ).one();
      expect(last).toEqual({
        client_op_id: `move-${lastRevision - 1}`, actor_account_id: OWNER, source: "user",
      });
    });
  });
});

describe("ProcessStudioApiImpl", () => {
  it("creates, lists, and opens projects for members only", async () => {
    const owner = studio(`studio-owner-${crypto.randomUUID()}`);
    const strangerId = `studio-stranger-${crypto.randomUUID()}`;
    const stranger = studio(strangerId);

    const summary = await owner.createProject("  Claims handling ");
    expect(summary.name).toBe("Claims handling");
    expect((await owner.listProjects()).map((p) => p.projectId)).toEqual([summary.projectId]);
    expect(await stranger.listProjects()).toEqual([]);

    await expect(stranger.openProject(summary.projectId)).rejects.toThrow(/do not have access/);
    await expect(owner.openProject("not a valid id!")).rejects.toThrow(/Invalid project ID/);
    await expect(owner.createProject("   ")).rejects.toThrow(/must not be empty/);

    const handle = await owner.openProject(summary.projectId);
    expect((await handle.snapshot()).role).toBe("owner");
    expect(await handle.applyOps({ clientOpId: "c1", baseRevision: 0, ops: SEED }))
      .toEqual({ ok: true, revision: 1 });
    const [listed] = await owner.listProjects();
    expect(listed?.updatedAt).toBeGreaterThanOrEqual(summary.updatedAt);

    await expect(handle.subscribe({ changed() {}, reset() {} }, 0)).rejects.toThrow(/not implemented/);
    await expect(handle.createInvite("editor")).rejects.toThrow(/not implemented/);
    await expect(stranger.joinProject("key")).rejects.toThrow(/not implemented/);

    await projectStub(summary.projectId).addMember(strangerId, "editor");
    expect((await stranger.listProjects()).map((p) => p.projectId)).toEqual([summary.projectId]);
    const joined = await stranger.openProject(summary.projectId);
    expect((await joined.snapshot()).role).toBe("editor");
  });
});
