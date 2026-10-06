// Process Studio lets you collaboratively map a business process as a swimlane graph with the
// people working on it. A `ProcessProject` binding is one project: current and target models,
// persistent analysis artifacts, and a decision log.
// Every agreed change is recorded as a decision with its rationale, so later conversations build
// on what was settled instead of reopening it.
//
// The canvas the stakeholders look at is drawn from this binding, so change the process only
// through `applyChanges()`; never write gadget code or web pages to draw it. Omit `x`/`y` when
// adding steps; stakeholders tidy the layout from the canvas. Capture what you learn about each
// step (description, owner, system, inputs, outputs, duration, pain points) in its fields.
//
// Before changing a project, call `getContext()` and build on its active decisions: do not reopen
// or contradict them without the user asking. Elements covered by a *locked* decision cannot be
// changed unless you name that decision in `supersedes` and explain why. Ask the user rather than
// guessing when information or intent is missing, and record the question with `raiseQuestion()`
// so other stakeholders can see it.
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
// Build the lifecycle progressively from confirmed evidence: outcomes and stakeholder roles,
// then requirements with measurable acceptance criteria and source/outcome/stakeholder/target-step
// links. Use `model: "toBe"` for the target design, never overwrite the as-is process to depict
// a future idea. Send artifact edits in `lifecycleOps` alongside graph edits when they depend on
// one another. A requirement's nodeIds and a scenario's pathNodeIds always refer to the to-be
// model. IDs must remain stable when updating an artifact. Validate actual paths and record
// expected/actual results and unresolved findings. Never invent stakeholder agreement, test
// results, measurement data, or source evidence. Baseline reviews are human-owned; a baseline
// record is not approved unless its review says so. Monitor measurements are sourced observations,
// not generated telemetry or proof of deployed execution.
// `getContext().validation` lists concrete completeness gaps in both models and the lifecycle.
// Work through these with the user before declaring the analysis ready for human review.

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
  /** Model this decision concerns; absent on older as-is decisions. */
  model?: ProcessModel;
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

/** Everything you need before changing a project. */
export type ProjectContext = {
  /** Completeness gaps in the models, traceability and recorded validation evidence. */
  validation: BaValidationIssue[];
  /** Earlier changes that no longer fit the current project; resolve these before relying on them. */
  changeWarnings?: string[];
  /** Persistent business-analysis artifacts, target model, and review history. */
  lifecycle: BaLifecycle;
  projectId: string;
  name: string;
  graph: ProcessGraph;
  /** Active decisions, newest first. */
  decisions: Decision[];
  /** Unresolved questions, oldest first. */
  openQuestions: OpenQuestion[];
  /** A lightweight elicitation checklist inferred from the graph; see the header comment. */
  coverage: CoverageItem[];
};

/** A coherent set of edits with the reasoning behind it. */
export type ChangeSet = {
  /** Model to edit; omitted means the existing as-is model. */
  model?: ProcessModel;
  /** Artifact edits applied atomically with the graph edits. */
  lifecycleOps?: LifecycleOp[];
  /** One-line summary shown to stakeholders, for example "Add document-chase exception path". */
  summary: string;
  /** Why this change is needed, grounded in what the user said. */
  rationale: string;
  /** Edits applied together, in order. May be empty when lifecycleOps is non-empty. */
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
  /** Returns the graph, active decisions, and open questions. Call this before proposing changes. */
  getContext(): Promise<ProjectContext>;

  /** Returns the current graph only. */
  getGraph(model?: ProcessModel): Promise<ProcessGraph>;

  /**
   * Applies a change set and records it as a decision. Throws if an op is invalid (unknown or
   * duplicate ID, dangling edge, non-empty lane delete), or if an op touches an element of a locked
   * decision that is not listed in `supersedes`.
   */
  applyChanges(change: ChangeSet): Promise<ChangeReceipt>;

  /** Records an open question for stakeholders. Returns its ID. */
  raiseQuestion(question: { text: string; nodeIds?: string[] }): Promise<{ questionId: string }>;
}

/** The current process or its separately editable target design. */
export type ProcessModel = "asIs" | "toBe";

/** A measurable business outcome. Null numeric values mean not yet established. */
export type BaOutcome = {
  kind: "outcome";
  id: string;
  title: string;
  metric: string;
  unit: string;
  baseline: number | null;
  target: number | null;
  direction: "increase" | "decrease";
};

/** A person or role involved in the analysis; this is descriptive, not sign-off authority. */
export type BaStakeholder = {
  kind: "stakeholder";
  id: string;
  title: string;
  role: string;
  notes: string;
};

/** A requirement traced to business outcomes, stakeholders, and target process steps. */
export type BaRequirement = {
  kind: "requirement";
  id: string;
  title: string;
  statement: string;
  priority: "must" | "should" | "could" | "wont";
  acceptanceCriteria: string[];
  outcomeIds: string[];
  stakeholderIds: string[];
  nodeIds: string[];
  source: string;
};

/** Alternatives considered and the reasoning for selecting one. */
export type BaTradeoff = {
  kind: "tradeoff";
  id: string;
  title: string;
  options: string[];
  selection: string;
  rationale: string;
  requirementIds: string[];
};

/** A recorded validation exercise against requirements and a path in the target model. */
export type BaScenario = {
  kind: "scenario";
  id: string;
  title: string;
  requirementIds: string[];
  pathNodeIds: string[];
  expected: string;
  actual: string;
  status: "untested" | "passed" | "failed";
};

/** An issue discovered during analysis or validation. */
export type BaFinding = {
  kind: "finding";
  id: string;
  title: string;
  scenarioId: string;
  severity: "blocking" | "advisory";
  status: "open" | "resolved";
  resolution: string;
};

/** A real, sourced outcome measurement, not simulated operational telemetry. */
export type BaMeasurement = {
  kind: "measurement";
  id: string;
  title: string;
  outcomeId: string;
  value: number;
  measuredAt: number;
  source: string;
};

/** An implementation work item with an accountable owner and linked requirements. */
export type BaHandoff = {
  kind: "handoff";
  id: string;
  title: string;
  owner: string;
  description: string;
  requirementIds: string[];
  status: "planned" | "inProgress" | "done";
};

/** One persistent, stable-ID business-analysis artifact. */
export type BaArtifact =
  | BaOutcome | BaStakeholder | BaRequirement | BaTradeoff
  | BaScenario | BaFinding | BaMeasurement | BaHandoff;

/** An artifact edit. Referenced IDs must exist after the entire batch has been applied. */
export type LifecycleOp =
  | { op: "putArtifact"; artifact: BaArtifact }
  | { op: "deleteArtifact"; id: string };

/** Immutable project content captured for review and implementation handoff. */
export type BaBaselineContent = {
  projectId: string;
  name: string;
  revision: number;
  asIs: ProcessGraph;
  toBe: ProcessGraph;
  artifacts: BaArtifact[];
  decisions: Decision[];
  openQuestions: OpenQuestion[];
};

/** A captured review package. Review identity is the owning connected account's stable ID. */
export type BaBaseline = {
  id: string;
  createdAt: number;
  content: BaBaselineContent;
  review?: {
    decision: "approved" | "rejected";
    accountId: string;
    at: number;
    note: string;
  };
};

/** Persistent project lifecycle state; the original graph remains the as-is model. */
export type BaLifecycle = {
  contentRevision: number;
  artifacts: BaArtifact[];
  toBe: ProcessGraph;
  baselines: BaBaseline[];
};

/** A concrete completeness gap blocking baseline approval. */
export type BaValidationIssue = {
  code: string;
  message: string;
  artifactId?: string;
};
