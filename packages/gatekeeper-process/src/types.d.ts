// Process Studio lets you collaboratively map a business process as a swimlane graph with the
// people working on it. A `ProcessProject` binding is one project: one graph plus a decision log.
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

/** Everything you need before changing a project. */
export type ProjectContext = {
  projectId: string;
  name: string;
  graph: ProcessGraph;
  /** Active decisions, newest first. */
  decisions: Decision[];
  /** Unresolved questions, oldest first. */
  openQuestions: OpenQuestion[];
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
  /** Returns the graph, active decisions, and open questions. Call this before proposing changes. */
  getContext(): Promise<ProjectContext>;

  /** Returns the current graph only. */
  getGraph(): Promise<ProcessGraph>;

  /**
   * Applies a change set and records it as a decision. Throws if an op is invalid (unknown or
   * duplicate ID, dangling edge, non-empty lane delete), or if an op touches an element of a locked
   * decision that is not listed in `supersedes`.
   */
  applyChanges(change: ChangeSet): Promise<ChangeReceipt>;

  /** Records an open question for stakeholders. Returns its ID. */
  raiseQuestion(question: { text: string; nodeIds?: string[] }): Promise<{ questionId: string }>;
}
