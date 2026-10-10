/**
 * Scripted elicitation turns for messy real answers. Session tests drive these through the
 * ProcessProject agent session (no live model — see CF_AI_GATEWAY blocker on the roadmap).
 *
 * Each fixture names the playbook recovery path from ELICITATION.md and the tool sequence the
 * agent should prefer before inventing graph structure.
 */

export type ElicitationFixtureId =
  | "contradiction-two-stakeholders"
  | "unknown-reassign"
  | "scope-creep-confirm"
  | "rotate-after-blocked";

export type ElicitationFixture = {
  id: ElicitationFixtureId;
  /** Human-readable scenario the BA agent hits in the wild. */
  scenario: string;
  /** Ordered tool names the playbook expects before any contested applyChanges. */
  expectedToolsBeforeGraph: readonly string[];
  /** Facts the session must leave true after the scripted turn. */
  invariants: readonly string[];
};

/** Canonical messy-answer sequences covered by elicitation session tests. */
export const ELICITATION_FIXTURES: readonly ElicitationFixture[] = [
  {
    id: "contradiction-two-stakeholders",
    scenario:
      "Elena says approvals start at £5k; Sam says £25k. Agent must not encode one threshold.",
    expectedToolsBeforeGraph: [
      "getContext",
      "upsertStakeholder",
      "upsertStakeholder",
      "setInterviewTarget",
      "raiseQuestion",
    ],
    invariants: [
      "both stakeholders remain on the register",
      "clarifying question names both sides",
      "graph has no approval-threshold node invented from either answer",
      "interviewPlan shows open assigned questions",
    ],
  },
  {
    id: "unknown-reassign",
    scenario:
      "Ask-next says they do not know the exception owner and points at Ops.",
    expectedToolsBeforeGraph: [
      "getContext",
      "upsertStakeholder",
      "setInterviewTarget",
      "raiseQuestion",
    ],
    invariants: [
      "Ops is on the register",
      "exception question is assigned to Ops",
      "ask-next rotates to Ops (or clears then suggests Ops)",
      "no invented exception branch on the graph",
    ],
  },
  {
    id: "scope-creep-confirm",
    scenario:
      "During onboarding mapping, the user starts describing vendor procurement.",
    expectedToolsBeforeGraph: [
      "getContext",
      "raiseQuestion",
    ],
    invariants: [
      "scope question asks whether procurement is in this project",
      "no procurement lane/node added before confirmation",
      "existing grounded graph revision is unchanged by the scope check turn",
    ],
  },
  {
    id: "rotate-after-blocked",
    scenario:
      "Current interview is blocked on another person; agent rotates ask-next.",
    expectedToolsBeforeGraph: [
      "getContext",
      "upsertStakeholder",
      "upsertStakeholder",
      "setInterviewTarget",
      "raiseQuestion",
      "setInterviewTarget",
    ],
    invariants: [
      "first person keeps their open question",
      "ask-next becomes the person who can unblock",
      "interviewPlan.suggestedNextStakeholderId matches ask-next while set",
    ],
  },
] as const;

export function fixtureById(id: ElicitationFixtureId): ElicitationFixture {
  const fixture = ELICITATION_FIXTURES.find((entry) => entry.id === id);
  if (!fixture) throw new Error(`Unknown elicitation fixture: ${id}`);
  return fixture;
}
