import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ELICITATION_FIXTURES, fixtureById } from "./elicitation-fixtures.js";
import type { ProcessTestWorkspace } from "./worker.js";

const testEnv = env as unknown as {
  WORKSPACE: DurableObjectNamespace<ProcessTestWorkspace>;
};

const DOMAIN = "test-domain";
const CREATOR = "creator-account";

function workspace(): DurableObjectStub<ProcessTestWorkspace> {
  return testEnv.WORKSPACE.getByName(crypto.randomUUID());
}

describe("elicitation fixtures catalog", () => {
  it("covers contradiction, unknown, scope creep, and rotation", () => {
    expect(ELICITATION_FIXTURES.map((f) => f.id).sort()).toEqual([
      "contradiction-two-stakeholders",
      "rotate-after-blocked",
      "scope-creep-confirm",
      "unknown-reassign",
    ].sort());
    for (const fixture of ELICITATION_FIXTURES) {
      expect(fixture.expectedToolsBeforeGraph[0]).toBe("getContext");
      expect(fixture.expectedToolsBeforeGraph).not.toContain("applyChanges");
      expect(fixture.invariants.length).toBeGreaterThan(0);
    }
  });
});

describe("elicitation session sequences (messy answers)", () => {
  it("contradiction: registers both sides, raises clarifying question, leaves graph empty", async () => {
    const fixture = fixtureById("contradiction-two-stakeholders");
    expect(fixture.expectedToolsBeforeGraph).toContain("raiseQuestion");

    const ws = workspace();
    await ws.bind("PROCESS", DOMAIN, CREATOR, "process://new?name=Approvals");
    const turn = await ws.proposeStakeholdersAsAgent("PROCESS", "apply", {
      upsert: { name: "Elena Voss", role: "KYC lead", stance: "champion" },
      upsertMore: [{ name: "Sam Ortiz", role: "Ops", stance: "supporter" }],
      interviewTarget: "CREATED",
      question: {
        text:
          "Approval threshold conflict: Elena said £5k, Sam said £25k — which is correct for this process?",
        assigneeStakeholderId: "CREATED",
      },
    });

    expect(turn.errors).toEqual([]);
    expect(turn.createdIds).toHaveLength(2);
    expect(turn.committed.stakeholders).toMatchObject([
      { name: "Elena Voss" },
      { name: "Sam Ortiz" },
    ]);
    expect(turn.committed.graph.nodes).toEqual([]);
    expect(turn.committed.openQuestions).toHaveLength(1);
    expect(turn.committed.openQuestions[0].text).toMatch(/£5k/);
    expect(turn.committed.openQuestions[0].text).toMatch(/£25k/);
    expect(turn.committed.openQuestions[0].assigneeStakeholderId).toBe(turn.createdIds[0]);
    expect(turn.committed.interviewTargetStakeholderId).toBe(turn.createdIds[0]);

    const { context } = await ws.read("PROCESS");
    expect(context?.interviewPlan.people).toHaveLength(2);
    expect(context?.interviewPlan.people[0]).toMatchObject({
      name: "Elena Voss",
      next: "interviewing",
      openQuestionCount: 1,
    });
    expect(context?.interviewPlan.people[1]).toMatchObject({
      name: "Sam Ortiz",
      next: "raise-questions",
      openQuestionCount: 0,
    });
  });

  it("unknown: upserts the named person, reassigns the gap, rotates ask-next", async () => {
    fixtureById("unknown-reassign");
    const ws = workspace();
    await ws.bind("PROCESS", DOMAIN, CREATOR, "process://new?name=Onboarding");

    const first = await ws.proposeStakeholdersAsAgent("PROCESS", "apply", {
      upsert: { name: "Elena Voss", role: "KYC lead", stance: "champion" },
      interviewTarget: "CREATED",
      question: {
        text: "Who owns the document-chase exception path?",
        assigneeStakeholderId: "CREATED",
      },
    });
    expect(first.errors).toEqual([]);
    const elenaId = first.createdIds[0];

    // Elena does not know — agent registers Ops, moves the gap, rotates ask-next.
    const second = await ws.proposeStakeholdersAsAgent("PROCESS", "apply", {
      upsert: { name: "Sam Ortiz", role: "Ops", stance: "supporter" },
      interviewTarget: "CREATED",
      question: {
        text: "Elena does not know the exception owner — what is the document-chase exception path?",
        assigneeStakeholderId: "CREATED",
      },
    });
    expect(second.errors).toEqual([]);
    const samId = second.createdIds[0];

    expect(second.committed.stakeholders.map((s) => s.name).sort()).toEqual([
      "Elena Voss",
      "Sam Ortiz",
    ]);
    expect(second.committed.graph.nodes).toEqual([]);
    expect(second.committed.interviewTargetStakeholderId).toBe(samId);
    expect(second.committed.openQuestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringMatching(/exception/i),
          assigneeStakeholderId: elenaId,
        }),
        expect.objectContaining({
          text: expect.stringMatching(/Elena does not know/i),
          assigneeStakeholderId: samId,
        }),
      ]),
    );

    const { context } = await ws.read("PROCESS");
    expect(context?.interviewPlan.suggestedNextStakeholderId).toBe(samId);
    expect(context?.interviewPlan.people.find((p) => p.stakeholderId === samId)).toMatchObject({
      next: "interviewing",
      openQuestionCount: 1,
    });
  });

  it("scope creep: raises an in-scope check and does not add tangent lanes", async () => {
    fixtureById("scope-creep-confirm");
    const ws = workspace();
    await ws.bind("PROCESS", DOMAIN, CREATOR, "process://new?name=Customer onboarding");

    const grounded = await ws.proposeAsAgent("PROCESS", {
      summary: "Seed happy path start",
      rationale: "User confirmed onboarding starts with application intake",
      ops: [
        { op: "addLane", lane: { id: "sales", label: "Sales" } },
        {
          op: "addNode",
          node: { id: "start", type: "startEvent", label: "Start", laneId: "sales" },
        },
        {
          op: "addNode",
          node: { id: "intake", type: "userTask", label: "Intake application", laneId: "sales" },
        },
        { op: "addEdge", edge: { id: "e1", source: "start", target: "intake" } },
      ],
    }, "apply");
    expect(grounded.errors).toEqual([]);
    const nodesBefore = grounded.committed.graph.nodes.map((n) => n.id).sort();
    const lanesBefore = grounded.committed.graph.lanes.map((l) => l.id);

    const scopeCheck = await ws.proposeStakeholdersAsAgent("PROCESS", "apply", {
      question: {
        text:
          "Is vendor procurement in scope for this Customer onboarding map, or should it be a separate process?",
      },
    });
    expect(scopeCheck.errors).toEqual([]);
    // raiseQuestion advances project revision, but must not invent tangent structure.
    expect(scopeCheck.committed.graph.lanes.map((l) => l.id)).toEqual(lanesBefore);
    expect(scopeCheck.committed.graph.nodes.map((n) => n.id).sort()).toEqual(nodesBefore);
    expect(scopeCheck.committed.graph.lanes.some((l) => /procur/i.test(l.label))).toBe(false);
    expect(scopeCheck.committed.openQuestions).toMatchObject([{
      text: expect.stringMatching(/procurement/i),
    }]);
    expect(scopeCheck.committed.openQuestions[0].text).toMatch(/in scope|separate process/i);
  });

  it("rotation: blocked interview clears to the person who can unblock", async () => {
    fixtureById("rotate-after-blocked");
    const ws = workspace();
    await ws.bind("PROCESS", DOMAIN, CREATOR, "process://new?name=KYC");

    const seed = await ws.proposeStakeholdersAsAgent("PROCESS", "apply", {
      upsert: { name: "Elena Voss", role: "KYC lead", stance: "champion" },
      upsertMore: [{ name: "Sam Ortiz", role: "Ops", stance: "supporter" }],
      interviewTarget: "CREATED",
      question: {
        text: "What triggers a KYC review?",
        assigneeStakeholderId: "CREATED",
      },
    });
    expect(seed.errors).toEqual([]);
    const [elenaId, samId] = seed.createdIds;
    expect(elenaId && samId).toBeTruthy();
    expect(seed.committed.interviewTargetStakeholderId).toBe(elenaId);

    // Elena is blocked on Ops — raise Ops' question and rotate ask-next.
    const rotate = await ws.proposeStakeholdersAsAgent("PROCESS", "apply", {
      interviewTarget: samId,
      question: {
        text: "Ops: which evidence pack is required before document chase?",
        assigneeStakeholderId: samId,
      },
    });
    expect(rotate.errors).toEqual([]);
    expect(rotate.committed.interviewTargetStakeholderId).toBe(samId);
    expect(rotate.committed.openQuestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "What triggers a KYC review?",
          assigneeStakeholderId: elenaId,
        }),
        expect.objectContaining({
          text: expect.stringMatching(/evidence pack/i),
          assigneeStakeholderId: samId,
        }),
      ]),
    );

    const { context } = await ws.read("PROCESS");
    expect(context?.interviewPlan.suggestedNextStakeholderId).toBe(samId);
    expect(context?.interviewPlan.people.find((p) => p.stakeholderId === samId)).toMatchObject({
      next: "interviewing",
      openQuestionCount: 1,
      isTarget: true,
    });
    expect(context?.interviewPlan.people.find((p) => p.stakeholderId === elenaId)).toMatchObject({
      isTarget: false,
      next: "answer-open",
      openQuestionCount: 1,
    });
  });
});

