// Process Studio lets you collaboratively map a business process as a swimlane graph with the
// people working on it. A `ProcessProject` binding is one project: one graph plus a decision log
// and a thin stakeholder register. Every agreed change is recorded as a decision with its
// rationale, so later conversations build on what was settled instead of reopening it.
//
// The canvas the stakeholders look at is drawn from this binding, so change the process only
// through `applyChanges()`; never write gadget code or web pages to draw it. Omit `x`/`y` when
// adding steps; stakeholders tidy the layout from the canvas. Capture what you learn about each
// step (description, owner, system, inputs, outputs, duration, pain points) in its fields.
//
// Before changing a project, call `getContext()` and build on its active decisions: do not reopen
// or contradict them without the user asking. Elements covered by a *locked* decision cannot be
// changed unless you name that decision in `supersedes` and explain why. Ask rather than guessing
// when information or intent is missing, and record the question with `raiseQuestion()` so other
// stakeholders can see it. Prefer assigning each question to a register entry (`assigneeStakeholderId`)
// or a workspace collaborator (`assigneeUserId`) so the right person sees it.
//
// Keep the stakeholder register current with `upsertStakeholder()` as you learn who matters (name,
// role, stance). Set `setInterviewTarget()` to the person you intend to ask next, and clear it
// when that conversation is done. Interview participants are register entries and/or workspace
// collaborators linked via `userId` on a register entry. Prefer a short interview plan: after
// `getContext()`, read `interviewPlan` — if `interviewTargetStakeholderId` is null, call
// `setInterviewTarget(interviewPlan.suggestedNextStakeholderId)` when that id is non-null, then
// raise questions assigned to them (or answer their open ones) before expanding the graph further.
//
// Placement is a BA judgment call, not a default: when a request doesn't say which lane, which
// point in the sequence, or which branch a step belongs on, work it out from what the graph and
// decisions already establish, and if it's still unclear, ask with `raiseQuestion()` before
// proposing the change. In particular, never default to attaching a new step to whichever end
// event or exception path happens to be nearest just because it was the last thing added.
//
// `getContext()` also returns `coverage`: a checklist of standard BA questions (scope, happy path,
// exceptions, roles/systems, pain points, measures) inferred from the graph so far. Steer the
// conversation toward whichever items are not yet `done`, using their `hint`, instead of only
// following up on what the user happened to mention first. Treat `coverage` as a floor, not a
// target: `done` can reflect partial evidence (e.g. half the steps have an owner), so keep going
// until every step genuinely has one, and keep probing branches until the user confirms nothing
// else is missing. Before calling a phase finished, look at the graph itself for gaps a principal
// BA would catch: steps unreachable from the start, gateway branches that dead-end, or outcomes
// with no end event.
//
// Real stakeholder answers are messy. When two people (or turns) contradict each other, raise a
// clarifying `raiseQuestion` that names both sides — do not pick a winner in `applyChanges` or
// silently overwrite a locked decision. When someone says they do not know, leave that coverage
// item open, re-assign or retarget whoever they named (`upsertStakeholder` if needed), and never
// invent owners, systems, or exception branches to close the gap. When the conversation drifts
// into adjacent processes or “while we’re at it” scope, pause and ask whether that material belongs
// in *this* project before adding lanes or nodes; capture a scope decision or leave a question and
// stay on the grounded path. Prefer the recovery loop in ELICITATION.md: getContext → register /
// retarget → raiseQuestion → only then applyChanges for uncontested, placement-clear facts.

/** BPMN 2.0 element kinds supported on the canvas. */
export type ProcessNodeType =
  | "startEvent"
  | "endEvent"
  | "timerEvent"
  | "userTask"
  | "serviceTask"
  | "manualTask"
  | "exclusiveGateway"
  | "parallelGateway";

/** A swimlane: the role, team, or system that performs the steps placed in it. */
export type ProcessLane = {
  /** Stable lane ID. */
  id: string;
  /** Display label, for example "Compliance". */
  label: string;
};

/** One step, event, or decision point on the canvas. */
export type ProcessNode = {
  /** Stable node ID. */
  id: string;
  /** BPMN element kind. */
  type: ProcessNodeType;
  /** Short display label, for example "Verify documents". */
  label: string;
  /** ID of the lane that performs this step. */
  laneId: string;
  /** Canvas position in pixels. `addNode` may omit it to place the node automatically. */
  x: number;
  y: number;
  /** What happens in this step. */
  description?: string;
  /** Role or team responsible for this step. */
  owner?: string;
  /** Tool or system used to perform this step. */
  system?: string;
  /** What this step needs before it can start, e.g. "Signed contract". */
  inputs?: string[];
  /** What this step produces, e.g. "Approved invoice". */
  outputs?: string[];
  /** Estimated time to complete this step. */
  duration?: StepDuration;
  /** Known issues or friction at this step. */
  painPoints?: string;
};

/** A unit of time used to estimate how long a step takes. */
export type DurationUnit = "minutes" | "hours" | "days";

/** An estimated duration for a step. */
export type StepDuration = {
  amount: number;
  unit: DurationUnit;
};

/** A sequence flow between two nodes. */
export type ProcessEdge = {
  /** Stable edge ID. */
  id: string;
  /** Source node ID. */
  source: string;
  /** Target node ID. */
  target: string;
  /** Optional condition label, typically used on gateway branches, for example "Approved". */
  label?: string;
};

/** The complete graph of a project. */
export type ProcessGraph = {
  /** Monotonic revision, incremented by every applied change. */
  revision: number;
  lanes: ProcessLane[];
  nodes: ProcessNode[];
  edges: ProcessEdge[];
};

/**
 * One atomic graph edit. IDs you add must be new; IDs you reference must exist (or be added
 * earlier in the same change). Deleting a node also deletes its edges; deleting a lane requires
 * it to be empty.
 */
export type GraphOp =
  | { op: "addLane"; lane: ProcessLane }
  | { op: "renameLane"; id: string; label: string }
  | { op: "deleteLane"; id: string }
  | { op: "addNode"; node: Omit<ProcessNode, "x" | "y"> & { x?: number; y?: number } }
  | {
      op: "updateNode";
      id: string;
      label?: string;
      type?: ProcessNodeType;
      laneId?: string;
      /** Pass a value to set it, `null` to clear it, or omit to leave it unchanged. */
      description?: string | null;
      owner?: string | null;
      system?: string | null;
      inputs?: string[] | null;
      outputs?: string[] | null;
      duration?: StepDuration | null;
      painPoints?: string | null;
    }
  | { op: "moveNode"; id: string; x: number; y: number }
  | { op: "deleteNode"; id: string }
  | { op: "addEdge"; edge: ProcessEdge }
  | { op: "updateEdge"; id: string; label?: string }
  | { op: "deleteEdge"; id: string };

/** An agreed change, kept so later work respects it. */
export type Decision = {
  /** Stable decision ID. */
  decisionId: string;
  /** One-line statement of what was decided. */
  summary: string;
  /** Why it was decided. */
  rationale: string;
  /** Graph elements this decision concerns. */
  nodeIds: string[];
  edgeIds: string[];
  /** Whether the elements are locked while the decision is active. */
  locked: boolean;
  /** `superseded` decisions no longer apply and are kept for history. */
  status: "active" | "superseded";
  /** The decision that replaced this one, when superseded. */
  supersededBy?: string;
  /** When it was decided, as Unix epoch milliseconds. */
  decidedAt: number;
};

/** How engaged a stakeholder is with the change. */
export type StakeholderStance = "champion" | "supporter" | "neutral" | "sceptic";

/** One person in the project's stakeholder register. */
export type Stakeholder = {
  /** Stable register ID. */
  stakeholderId: string;
  /** Display name. */
  name: string;
  /** Job title, team, or BA role, for example "KYC lead". */
  role: string;
  /** Engagement stance toward the process change. */
  stance: StakeholderStance;
  /** Optional workspace collaborator this register entry refers to. */
  userId?: string;
};

/** Create or update a stakeholder register entry. */
export type StakeholderInput = {
  /** Omit to create; pass an existing id to update. */
  stakeholderId?: string;
  name: string;
  role: string;
  /** Defaults to `neutral` when creating. */
  stance?: StakeholderStance;
  /** Pass a workspace user id to link, or `null` to clear an existing link. */
  userId?: string | null;
};

/** An unresolved question stakeholders need to answer. */
export type OpenQuestion = {
  /** Stable question ID. */
  questionId: string;
  /** The question itself. */
  text: string;
  /** Graph elements the question concerns, if any. */
  nodeIds: string[];
  /** When it was raised, as Unix epoch milliseconds. */
  raisedAt: number;
  /** Register entry this question is assigned to, if any. */
  assigneeStakeholderId?: string;
  /** Workspace collaborator this question is assigned to, if any. */
  assigneeUserId?: string;
};

/** One of the standard BA elicitation questions the coverage checklist tracks. */
export type CoverageKey = "scope" | "happyPath" | "exceptions" | "rolesAndSystems" | "painPoints" | "measures";

/** Whether one elicitation category looks covered yet, and what to ask next if not. */
export type CoverageItem = {
  key: CoverageKey;
  label: string;
  done: boolean;
  /** What to ask or capture next; only meaningful while `done` is false. */
  hint: string;
};

/** What the agent should do next with one register entry on the interview plan. */
export type InterviewPlanNext = "interviewing" | "answer-open" | "raise-questions";

/** One person on the interview plan derived from the register and open questions. */
export type InterviewPlanPerson = {
  stakeholderId: string;
  name: string;
  role: string;
  isTarget: boolean;
  openQuestionCount: number;
  next: InterviewPlanNext;
};

/**
 * Who still needs attention in the multi-stakeholder elicitation loop. Derived only — nothing is
 * persisted. Prefer `suggestedNextStakeholderId` when ask-next is unset.
 */
export type InterviewPlan = {
  people: InterviewPlanPerson[];
  suggestedNextStakeholderId: string | null;
};

/** Everything you need before changing a project. */
export type ProjectContext = {
  projectId: string;
  name: string;
  graph: ProcessGraph;
  /** Active decisions, newest first. */
  decisions: Decision[];
  /** Unresolved questions, oldest first. */
  openQuestions: OpenQuestion[];
  /** Stakeholder register, oldest first. */
  stakeholders: Stakeholder[];
  /** Who to interview next; null when unset. */
  interviewTargetStakeholderId: string | null;
  /** A lightweight elicitation checklist inferred from the graph; see the header comment. */
  coverage: CoverageItem[];
  /** People checklist: who is ask-next, who has open questions, who still needs questions. */
  interviewPlan: InterviewPlan;
};

/** A coherent set of edits with the reasoning behind it. */
export type ChangeSet = {
  /** One-line summary shown to stakeholders, for example "Add document-chase exception path". */
  summary: string;
  /** Why this change is needed, grounded in what the user said. */
  rationale: string;
  /** Edits applied together, in order. Must be non-empty. */
  ops: GraphOp[];
  /**
   * Active decisions this change replaces. Required when any op other than `moveNode` touches an
   * element of a locked decision; each listed decision is marked superseded by this change.
   */
  supersedes?: string[];
};

/** Result of `applyChanges()`. */
export type ChangeReceipt = {
  /** The decision recording this change. */
  decisionId: string;
  /** The graph as it now reads, including this change. */
  graph: ProcessGraph;
};

/** Summary of a project. */
export type ProjectSummary = {
  projectId: string;
  name: string;
  /** Last change, as Unix epoch milliseconds. */
  updatedAt: number;
};

/** One process project. */
export interface ProcessProject {
  /** Returns the graph, active decisions, open questions, and stakeholder register. Call first. */
  getContext(): Promise<ProjectContext>;

  /** Returns the current graph only. */
  getGraph(): Promise<ProcessGraph>;

  /**
   * Applies a change set and records it as a decision. Throws if an op is invalid (unknown or
   * duplicate ID, dangling edge, non-empty lane delete), or if an op touches an element of a locked
   * decision that is not listed in `supersedes`.
   */
  applyChanges(change: ChangeSet): Promise<ChangeReceipt>;

  /**
   * Records an open question for stakeholders. Prefer assigning it to a register entry or
   * workspace collaborator. Returns its ID.
   */
  raiseQuestion(question: {
    text: string;
    nodeIds?: string[];
    assigneeStakeholderId?: string;
    assigneeUserId?: string;
  }): Promise<{ questionId: string }>;

  /** Creates or updates a stakeholder register entry. */
  upsertStakeholder(input: StakeholderInput): Promise<Stakeholder>;

  /** Removes a stakeholder from the register. Open questions keep their text but lose the assignee. */
  removeStakeholder(stakeholderId: string): Promise<void>;

  /**
   * Sets who the agent should interview next. Pass `null` to clear. The id must exist in the
   * register when non-null.
   */
  setInterviewTarget(stakeholderId: string | null): Promise<void>;
}
