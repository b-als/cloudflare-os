// A `ProcessProject` binding is one business process being mapped, as a swimlane map that the
// person in this chat sees beside the conversation, drawn live from this binding.
//
// You are the business analyst, and the conversation is the whole product. The person describes
// their process in their own words; you lead. Take them through four phases in order: Understand
// (the problem, the outcome that would prove it solved, the people involved), Map (how it runs
// today, exceptions included, and where it hurts), Improve (the better process and its trade-offs)
// and Ship (sign-off and hand-off). Say so in plain words when you move on. The methods are your
// craft, not their vocabulary: don't name BPMN, RACI, SIPOC, MoSCoW or the like unless they do.
//
// On an empty map, don't open with a questionnaire. Propose a first draft straight away from what
// they told you: the lanes you can infer, a start event, the happy path in four to eight steps and
// an end event, in one `applyChanges()` whose summary says it is a first draft. Put anything you
// inferred rather than heard in that step's `description` so it gets confirmed. Then ask the single
// question that would most improve the draft. A visible draft is corrected faster than a perfect
// question is answered.
//
// After that, ask one question at a time in the chat and wait for the answer. Change the map only
// through `applyChanges()`, never with gadget code or web pages. Every change waits for the person
// to accept or reject it before you continue, and each accepted change is recorded as a decision
// with your rationale: build on `getContext().decisions` and don't reopen them unless the person
// does. Omit `x`/`y` when adding steps; the map places them in flow order. Record what you learn
// about each step (description, owner, system, inputs, outputs, duration, pain points) in its fields.
//
// Placement is your judgement, not a default: when it isn't clear which lane, which point in the
// flow or which branch a step belongs on, work it out from the map and the decisions, and ask if
// it's still unclear. Use `getContext().coverage` to decide what to ask next, treating it as a
// floor: before calling the map done, also check it yourself for steps that can't be reached,
// branches that dead-end and outcomes with no end event.

/** Step, event and decision-point kinds the map draws. */
export type ProcessNodeType =
  | "startEvent"
  | "endEvent"
  | "timerEvent"
  | "userTask"
  | "serviceTask"
  | "manualTask"
  | "exclusiveGateway"
  | "parallelGateway";

/** A swimlane: the role, team or system that performs the steps in it. */
export type ProcessLane = {
  /** Stable lane ID. */
  id: string;
  /** Display label, for example "Finance". */
  label: string;
};

/** One step, event or decision point. */
export type ProcessNode = {
  /** Stable node ID. */
  id: string;
  type: ProcessNodeType;
  /** Short display label, for example "Verify documents". */
  label: string;
  /** ID of the lane that performs this step. */
  laneId: string;
  /** Map position in pixels. `addNode` may omit both to place the step in flow order. */
  x: number;
  y: number;
  /** What happens in this step, including anything inferred that still needs confirming. */
  description?: string;
  /** Role or team responsible. */
  owner?: string;
  /** Tool or system used. */
  system?: string;
  /** What the step needs before it can start, for example "Signed contract". */
  inputs?: string[];
  /** What the step produces, for example "Approved invoice". */
  outputs?: string[];
  /** How long the step takes. */
  duration?: StepDuration;
  /** Known friction at this step. */
  painPoints?: string;
};

/** A unit of time for a step's duration. */
export type DurationUnit = "minutes" | "hours" | "days";

/** How long a step takes. */
export type StepDuration = {
  amount: number;
  unit: DurationUnit;
};

/** A flow between two nodes. */
export type ProcessEdge = {
  /** Stable edge ID. */
  id: string;
  /** Source node ID. */
  source: string;
  /** Target node ID. */
  target: string;
  /** Condition label, typically on a gateway's branches, for example "Approved". */
  label?: string;
};

/** The whole map. */
export type ProcessGraph = {
  /** Increases with every applied change. */
  revision: number;
  lanes: ProcessLane[];
  nodes: ProcessNode[];
  edges: ProcessEdge[];
};

/**
 * One atomic map edit. IDs you add must be new, and IDs you reference must exist or be added earlier
 * in the same change. Deleting a node also deletes its edges; a lane must be empty to delete.
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

/** An accepted change, kept so later work builds on it instead of reopening it. */
export type Decision = {
  decisionId: string;
  /** One line: what was decided. */
  summary: string;
  /** Why, in the person's terms. */
  rationale: string;
  /** Map elements it concerns that still exist. */
  nodeIds: string[];
  edgeIds: string[];
  /** When it was accepted, as Unix epoch milliseconds. */
  decidedAt: number;
};

/** A standard question a good process map answers. */
export type CoverageKey = "scope" | "happyPath" | "exceptions" | "rolesAndSystems" | "painPoints" | "measures";

/** Whether the map answers one coverage question yet, and what to ask if not. */
export type CoverageItem = {
  key: CoverageKey;
  label: string;
  done: boolean;
  /** What to ask or capture next; only meaningful while `done` is false. */
  hint: string;
};

/** Everything you need before changing the map. */
export type ProjectContext = {
  name: string;
  /** The map, including your changes still waiting for the person's decision. */
  graph: ProcessGraph;
  /** Accepted decisions, newest first. */
  decisions: Decision[];
  /** What the map answers so far; see the header comment. */
  coverage: CoverageItem[];
};

/** A coherent set of edits with the reason for it. */
export type ChangeSet = {
  /** One line the person reads on the card, for example "Add the document-chase exception". */
  summary: string;
  /** Why, grounded in what the person said. */
  rationale: string;
  /** Edits applied together, in order. Must not be empty. */
  ops: GraphOp[];
};

/** Result of `applyChanges()`. */
export type ChangeReceipt = {
  /** The decision this change becomes once accepted. */
  decisionId: string;
  /** The map as it will read if the person accepts. */
  graph: ProcessGraph;
};

/** One process being mapped. */
export interface ProcessProject {
  /** Returns the map, decisions and coverage. Call it before proposing changes. */
  getContext(): Promise<ProjectContext>;

  /**
   * Proposes a change to the map. The person sees it on the map and accepts or rejects it in the
   * chat; this returns once it is queued. Throws if an op is invalid against the current map.
   */
  applyChanges(change: ChangeSet): Promise<ChangeReceipt>;
}
