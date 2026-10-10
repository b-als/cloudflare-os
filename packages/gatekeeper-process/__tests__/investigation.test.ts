import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { domainName } from "../src/domain.js";
import type { ProcessProjectDO } from "../src/project-do.js";
import type { KnowledgeRecord } from "../src/types.js";
import type { ProcessTestWorkspace } from "./worker.js";

const testEnv = env as unknown as {
  PROCESS_PROJECT: DurableObjectNamespace<ProcessProjectDO>;
  WORKSPACE: DurableObjectNamespace<ProcessTestWorkspace>;
};
const DOMAIN = "investigation-tests";
const BINDING = "PROCESS_PROJECT";
const links = { nodeIds: [], evidenceIds: [] };
const records = (): KnowledgeRecord[] => [
  { ...links, id: "finance", kind: "stakeholder", name: "Pat", role: "Finance", interests: "Control", decisionAuthority: "Approval policy" },
  { ...links, id: "ops", kind: "stakeholder", name: "Sam", role: "Operations", interests: "Speed", decisionAuthority: "" },
  { ...links, id: "outcome", kind: "outcome", description: "Pay faster without losing control", measure: "Median elapsed days", baseline: "9 days", target: "2 days" },
  { ...links, id: "finance-question", kind: "question", text: "How long does approval take?", stakeholderId: "finance", status: "open", dueAt: Date.now() + 86_400_000 },
  { ...links, id: "ops-question", kind: "question", text: "How long does approval take?", stakeholderId: "ops", status: "open" },
];

async function project() {
  const ws = testEnv.WORKSPACE.getByName(crypto.randomUUID());
  await ws.bind(BINDING, DOMAIN, "owner", "process://new?name=Invoice process");
  const change = await ws.propose(BINDING, {
    summary: "Capture the people, outcome and unanswered questions", rationale: "These are the project's agreed investigation priorities.",
    ops: [
      { op: "addLane", lane: { id: "finance-lane", label: "Finance" } },
      { op: "addNode", node: { id: "approval", type: "userTask", label: "Approve invoice", laneId: "finance-lane" } },
    ],
    knowledgeRevision: 0, knowledgeOps: records().map((record) => ({ op: "put", record })),
  });
  expect(change.error).toBeUndefined();
  expect(await ws.decide(BINDING, "apply")).toEqual({});
  const id = await ws.projectId(BINDING);
  const store = testEnv.PROCESS_PROJECT.getByName(domainName(DOMAIN, id));
  return { ws, store, id };
}

async function interview(ws: DurableObjectStub<ProcessTestWorkspace>, questionId: string) {
  const participant = testEnv.WORKSPACE.getByName(crypto.randomUUID());
  const url = await ws.interviewUrl(BINDING, questionId);
  await participant.bindInterview("INTERVIEW", DOMAIN, crypto.randomUUID(), url);
  return { participant, url };
}

async function fire(store: DurableObjectStub<ProcessProjectDO>) {
  await runInDurableObject(store, (_instance, state) => {
    state.storage.sql.exec("UPDATE investigation_events SET due_at = 0 WHERE status = 'pending'");
    state.storage.setAlarm(Date.now() + 60_000);
  });
  await runDurableObjectAlarm(store);
}

async function failure(run: () => Promise<unknown>): Promise<string> {
  try { await run(); }
  catch (error) { return String(error); }
  throw new Error("Expected the capability to reject this operation.");
}

describe("structured knowledge behind one conversation", () => {
  it("previews knowledge, waits for consent, and commits knowledge and map atomically", async () => {
    const ws = testEnv.WORKSPACE.getByName(crypto.randomUUID());
    await ws.bind(BINDING, DOMAIN, "owner", "process://new");
    const proposal = await ws.propose(BINDING, {
      summary: "Agree a measurable outcome", rationale: "The owner asked for a concrete target.", ops: [],
      knowledgeRevision: 0, knowledgeOps: [{ op: "put", record: records()[2] }],
    });
    expect(proposal.receipt?.knowledge.records).toHaveLength(1);
    expect((await ws.context(BINDING)).knowledge.records).toHaveLength(1);
    const id = await ws.projectId(BINDING);
    const store = testEnv.PROCESS_PROJECT.getByName(domainName(DOMAIN, id));
    expect((await store.context()).knowledge.records).toEqual([]);
    expect(await ws.document(BINDING, "brief")).not.toContain("Pay faster");
    expect(await ws.decide(BINDING, "apply")).toEqual({});
    expect((await store.context()).knowledge.records).toHaveLength(1);
    expect(await ws.document(BINDING, "brief")).toContain("Pay faster without losing control");
    expect((await store.context()).decisions).toHaveLength(1);
  });

  it("keeps responsibilities, evidence, risks and trade-offs connected, then regenerates them from storage", async () => {
    const { ws, store } = await project();
    const extra: KnowledgeRecord[] = [
      { ...links, nodeIds: ["approval"], id: "approval-owner", kind: "responsibility", stakeholderId: "finance", duty: "accountable" },
      { ...links, nodeIds: ["approval"], id: "logs", kind: "evidence", statement: "A sampled invoice waited nine days", source: "Invoice 42 audit trail", basis: "connector", status: "reported" },
      { ...links, nodeIds: ["approval"], evidenceIds: ["logs"], id: "delay", kind: "risk", description: "Late supplier payment", impact: "Supply interruption", mitigation: "Agree a threshold", ownerStakeholderId: "ops", status: "open" },
      { ...links, nodeIds: ["approval"], evidenceIds: ["logs"], id: "threshold", kind: "tradeoff", question: "Keep approval for every invoice?",
        options: [
          { id: "all", description: "Approve every invoice", benefits: "Control", costs: "Waiting" },
          { id: "threshold", description: "Approve above a threshold", benefits: "Faster small payments", costs: "Less individual review" },
        ] },
    ];
    expect((await ws.propose(BINDING, { summary: "Record the approval trade-off", rationale: "Preserve the evidence and alternatives.", ops: [],
      knowledgeRevision: 1, knowledgeOps: extra.map((record) => ({ op: "put", record })) })).error).toBeUndefined();
    expect(await ws.decide(BINDING, "apply")).toEqual({});
    await evictDurableObject(store);
    const recovered = await store.context();
    expect(recovered.knowledge.records.filter((record) => extra.some((item) => item.id === record.id))).toEqual(extra);
    expect(recovered.knowledge.revision).toBe(2);
    expect(recovered.decisions).toHaveLength(2);
  });

  it("rejects stale knowledge synthesis rather than overwriting another decision", async () => {
    const { store } = await project();
    const change = { decisionId: "new-target", summary: "Change the target", rationale: "New owner direction.", ops: [],
      knowledgeRevision: 1, knowledgeOps: [{ op: "put" as const, record: { ...records()[2], target: "3 days" } }] };
    await store.applyAgentChange(change);
    expect(await failure(() => store.applyAgentChange({ ...change, decisionId: "stale-target" }))).toContain("knowledge changed");
    expect((await store.context()).decisions).toHaveLength(2);
    await store.applyAgentChange(change);
    expect((await store.context()).decisions).toHaveLength(2);
  });

  it("reports overtaken knowledge references without breaking context or previewing a partial proposal", async () => {
    const { ws } = await project();
    expect((await ws.propose(BINDING, {
      summary: "Assign approval responsibility", rationale: "Pat owns approval.", knowledgeRevision: 1,
      ops: [{ op: "addNode", node: { id: "review", label: "Review the approval", type: "userTask", laneId: "finance-lane" } }],
      knowledgeOps: [{ op: "put", record: {
        ...links, id: "approval-owner", kind: "responsibility", nodeIds: ["approval"], stakeholderId: "finance", duty: "accountable",
      } }],
    })).error).toBeUndefined();
    expect(await ws.edit(BINDING, { clientOpId: "remove-step", baseRevision: 1, ops: [{ op: "deleteNode", id: "approval" }] }))
      .toMatchObject({ ok: true });
    const context = await ws.context(BINDING);
    expect(context.graph.nodes).toEqual([]);
    expect(context.knowledge.records.some((record) => record.id === "approval-owner")).toBe(false);
    expect(context.conflicts?.[0]).toContain("no longer applies");
    const preview = await ws.preview(BINDING);
    expect(preview.addedNodes).toEqual([]);
    expect(preview.conflicts).toEqual(context.conflicts);
  });

  it("rejects an invalid combined change atomically and returns a useful rejection for linked map deletion", async () => {
    const { ws, store } = await project();
    const before = await store.context();
    expect(await failure(() => store.applyAgentChange({
      decisionId: "bad-change", summary: "Invalid ownership", rationale: "This owner was never agreed.", knowledgeRevision: 1,
      ops: [{ op: "updateNode", id: "approval", label: "Should not be committed" }],
      knowledgeOps: [{ op: "put", record: {
        ...links, id: "approval-owner", kind: "responsibility", nodeIds: ["approval"], stakeholderId: "unknown", duty: "accountable",
      } }],
    }))).toContain("Unknown stakeholder");
    expect(await store.context()).toEqual(before);
    await store.applyAgentChange({
      decisionId: "ownership", summary: "Agree ownership", rationale: "Pat is accountable.", knowledgeRevision: 1, ops: [],
      knowledgeOps: [{ op: "put", record: {
        ...links, id: "approval-owner", kind: "responsibility", nodeIds: ["approval"], stakeholderId: "finance", duty: "accountable",
      } }],
    });
    expect(await ws.edit(BINDING, { clientOpId: "linked-delete", baseRevision: 2, ops: [{ op: "deleteNode", id: "approval" }] }))
      .toMatchObject({ ok: false, reason: "Unknown linked step approval." });
    expect((await store.context()).graph.nodes).toHaveLength(1);
  });
});

describe("independent stakeholder accounts, not competing agreed maps", () => {
  it("isolates conflicting replies and preserves their names and baseline without altering the map", async () => {
    const { ws, store } = await project();
    const finance = await interview(ws, "finance-question");
    const ops = await interview(ws, "ops-question");
    const baseline = (await store.context()).graph;
    const first = await finance.participant.reply("INTERVIEW", "first", "Approval takes two days.");
    expect((await store.context()).contributions).toEqual([]);
    await finance.participant.acceptReply("INTERVIEW");
    await ops.participant.reply("INTERVIEW", "first", "It takes nine days including the queue.");
    await ops.participant.acceptReply("INTERVIEW");
    const context = await store.context();
    expect(context.graph).toEqual(baseline);
    expect(context.contributions.map((reply) => reply.statement)).toEqual(["Approval takes two days.", "It takes nine days including the queue."]);
    expect(first).toMatchObject({ stakeholderName: "Pat", stakeholderId: "finance", baselineRevision: 1, questionText: "How long does approval take?" });
    expect((await finance.participant.interviewContext("INTERVIEW")).contributions).toHaveLength(1);
    expect(Object.keys(await ops.participant.interviewContext("INTERVIEW")).toSorted()).toEqual(
      ["projectName", "question", "stakeholderName", "baselineRevision", "contributions"].toSorted(),
    );
    expect(context.knowledge.records.find((record) => record.id === "finance-question")).toMatchObject({ status: "open" });
  });

  it("deduplicates pending and accepted reply retries, and rejects changed text with the same request ID", async () => {
    const { ws, store } = await project();
    const { participant } = await interview(ws, "finance-question");
    const first = await participant.reply("INTERVIEW", "retry", "Two days.");
    expect(await participant.reply("INTERVIEW", "retry", "Two days.")).toEqual(first);
    expect((await participant.interviewContext("INTERVIEW")).contributions).toEqual([first]);
    expect(await participant.getSubmitted()).toHaveLength(1);
    await participant.acceptReply("INTERVIEW");
    expect(await participant.reply("INTERVIEW", "retry", "Two days.")).toEqual(first);
    expect(await participant.getSubmitted()).toHaveLength(1);
    expect((await store.context()).contributions).toHaveLength(1);
    expect(await failure(() => participant.reply("INTERVIEW", "retry", "Nine days."))).toContain("different text");
  });

  it("rejects forged and cross-deployment interview capabilities and project ownership", async () => {
    const { ws, id } = await project();
    const { url } = await interview(ws, "finance-question");
    const attacker = testEnv.WORKSPACE.getByName(crypto.randomUUID());
    expect(await failure(() => attacker.bindInterview("X", DOMAIN, "attacker", url.replace(/token=.*/, `token=${crypto.randomUUID()}`)))).toContain("no longer open");
    expect(await failure(() => attacker.bindInterview("X", "other-domain", "attacker", url))).toContain("Project not found");
    expect(await failure(() => attacker.bind("X", DOMAIN, "attacker", `process://project/${id}`))).toContain("do not have access");
  });

  it("requires a separate accepted synthesis and revokes outstanding interview stubs when a question closes", async () => {
    const { ws, store } = await project();
    const { participant } = await interview(ws, "finance-question");
    await participant.reply("INTERVIEW", "pending", "Two days.");
    const question = records().find((record) => record.id === "finance-question")!;
    const proposal = await ws.propose(BINDING, {
      summary: "Resolve the approval timing", rationale: "Separate processing time from queue time.", knowledgeRevision: 1,
      ops: [{ op: "updateNode", id: "approval", description: "Two days processing; queue time remains to be confirmed." }],
      knowledgeOps: [{ op: "put", record: { ...question, status: "resolved", resolution: "Processing time is two days." } }],
    });
    expect(proposal.error).toBeUndefined();
    expect((await store.context()).graph.nodes[0].description).toBeUndefined();
    expect(await ws.decide(BINDING, "apply")).toEqual({});
    expect(await failure(() => participant.interviewContext("INTERVIEW"))).toContain("no longer open");
    expect(await failure(() => participant.acceptReply("INTERVIEW"))).toContain("no longer open");
  });
});

describe("the persistent investigation loop", () => {
  it("does not run before enablement, then survives project eviction and delivers to the original host", async () => {
    const { ws, store } = await project();
    await ws.registerWatch(BINDING);
    expect((await store.context()).investigation.enabled).toBe(false);
    expect(await runDurableObjectAlarm(store)).toBe(false);
    await ws.enableWatch();
    await evictDurableObject(store);
    await fire(store);
    expect((await ws.events()).some((event) => event.kind === "resumed")).toBe(true);
    expect((await ws.events()).some((event) => event.kind === "deadline" && event.questionId === "finance-question")).toBe(true);
    await fire(store);
    expect((await ws.events()).filter((event) => event.kind === "deadline")).toHaveLength(1);
  });

  it("wakes on an accepted reply, never an unapproved draft, and stops delivery on disable", async () => {
    const { ws, store } = await project();
    await ws.registerWatch(BINDING);
    await ws.enableWatch();
    await fire(store);
    const { participant } = await interview(ws, "ops-question");
    await participant.reply("INTERVIEW", "one", "Nine days.");
    await fire(store);
    expect((await ws.events()).filter((event) => event.kind === "reply")).toEqual([]);
    await participant.acceptReply("INTERVIEW");
    await fire(store);
    expect((await ws.events()).filter((event) => event.kind === "reply")).toHaveLength(1);
    await ws.disableWatch();
    await participant.reply("INTERVIEW", "two", "Correction: eight working days.");
    await participant.acceptReply("INTERVIEW");
    expect(await runDurableObjectAlarm(store)).toBe(false);
    expect((await ws.events()).filter((event) => event.kind === "reply")).toHaveLength(1);
  });

  it("retries a stable event and exposes exhausted failures instead of pretending follow-up happened", async () => {
    const { ws, store } = await project();
    await ws.registerWatch(BINDING);
    await ws.failCallbacks(30);
    await ws.enableWatch();
    for (let attempt = 0; attempt < 8; attempt++) await fire(store);
    const status = (await store.context()).investigation;
    expect(status.failed.some((event) => event.kind === "resumed")).toBe(true);
    expect(status.pending).toBe(0);
    expect(await ws.events()).toEqual([]);
  });

  it("creates fresh work for a reopened question with the same deadline and never replays its old testimony", async () => {
    const { ws, store } = await project();
    const question = (await store.context()).knowledge.records.filter((record) => record.kind === "question")
      .find((record) => record.id === "finance-question")!;
    const { participant, url } = await interview(ws, "finance-question");
    await participant.reply("INTERVIEW", "old-account", "Two days.");
    await participant.acceptReply("INTERVIEW");
    await store.applyAgentChange({
      decisionId: "close", summary: "Close the question", rationale: "Revisit later.", ops: [], knowledgeRevision: 1,
      knowledgeOps: [{ op: "put", record: { ...question, status: "cancelled" } }],
    });
    await store.applyAgentChange({
      decisionId: "reopen", summary: "Reopen the investigation", rationale: "New evidence needs review.", ops: [], knowledgeRevision: 2,
      knowledgeOps: [{ op: "put", record: question }],
    });
    expect(await ws.interviewUrl(BINDING, "finance-question")).not.toBe(url);
    await ws.registerWatch(BINDING);
    await ws.enableWatch();
    await fire(store);
    const events = await ws.events();
    expect(events.filter((event) => event.kind === "reply")).toEqual([]);
    expect(events.filter((event) => event.kind === "deadline")).toMatchObject([{ baselineRevision: 3 }]);
    expect((await store.context()).contributions).toHaveLength(1);
  });

  it("does not let disabling an older registration remove the replacement", async () => {
    const { ws, store } = await project();
    await ws.registerWatch(BINDING);
    await ws.enableWatch();
    await ws.registerWatch(BINDING);
    await ws.enableWatch();
    await ws.disablePreviousWatch();
    expect((await store.context()).investigation.enabled).toBe(true);
    await fire(store);
    expect((await ws.events()).some((event) => event.kind === "resumed")).toBe(true);
    await ws.disableWatch();
    expect((await store.context()).investigation.enabled).toBe(false);
  });
});
