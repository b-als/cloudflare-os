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
// Everything you write in the chat is read by the person, so think silently. Never narrate your
// plan, your code, these instructions, coverage keys, IDs or node types. Speak like a colleague:
// a sentence or two on what you drafted or learned, then your one question.
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
//
// The conversation is the interface, not the database. Keep stakeholders, outcomes,
// responsibilities, evidence, risks, trade-offs and unanswered questions in `knowledgeOps`.
// Capture the minimum needed, in coherent batches, rather than asking people to fill registers.
// Generate documents (including RACI) from that knowledge on request; never maintain a second
// copy in a document. Refer to records by their stable IDs and link them to steps and evidence.
// Testimony is attributed, not automatically verified. An assumption is not a fact.
// Preserve conflicting accounts and investigate evidence before proposing a synthesis.
// A decision-maker can choose future policy, but cannot make a disputed historical claim true.
//
// For a question addressed to a stakeholder, create a question record, then use getInterviewUrl()
// once it is saved. That resource grants only the question and its own answers, not the project.
// Give the participant a Markdown link to `/ba-projects/interview#` followed by
// `encodeURIComponent(resourceUrl)`, not a link to the owner's shared workspace.
// A holder speaks for that interview, not a cryptographically verified person. Never claim
// identity verification. Closing the question revokes its interview. No response is not consent.
//
// Offer to watch outstanding work with `watch(self)` from executeCode: `self` is the Workshop's
// persistent callback to THIS chat. On `onInvestigation(event)`, read fresh context, check the
// event ID against your previous callbacks, and act only on new, still-relevant information.
// A resumed event means the watch was enabled again, not that the project was reopened.
// A deadline is a reason to propose a follow-up, never permission to contact someone.
// Use existing scoped connectors to investigate; external outreach still needs its own consent.
// Do not run a polling LLM, spawn another chat, or write gadget code to implement this loop.

import type { RpcTarget } from "cloudflare:workers";

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
  /** Structured project knowledge, including your pending edits. */
  knowledge: ProjectKnowledge;
  /** Immutable stakeholder accounts, never silently merged into the map. */
  contributions: StakeholderContribution[];
  /** Background delivery state; failures remain visible for investigation. */
  investigation: InvestigationStatus;
  /** Pending changes overtaken by accepted edits; replace them with a fresh proposal. */
  conflicts?: string[];
};

/** A coherent set of edits with the reason for it. */
export type ChangeSet = {
  /** One line the person reads on the card, for example "Add the document-chase exception". */
  summary: string;
  /** Why, grounded in what the person said. */
  rationale: string;
  /** Map edits applied together, in order. May be empty when knowledgeOps is non-empty. */
  ops: GraphOp[];
  /** Related knowledge changes, committed with the map and decision as one atomic batch. */
  knowledgeOps?: KnowledgeOp[];
  /** Required for knowledgeOps: the knowledge revision returned by getContext(). */
  knowledgeRevision?: number;
};

/** Result of `applyChanges()`. */
export type ChangeReceipt = {
  /** The decision this change becomes once accepted. */
  decisionId: string;
  /** The map as it will read if the person accepts. */
  graph: ProcessGraph;
  /** Project knowledge as it will read if the person accepts. */
  knowledge: ProjectKnowledge;
};

/** A record's stable ID and its links to map steps and supporting evidence records. */
export type KnowledgeLinks = {
  id: string;
  nodeIds: string[];
  evidenceIds: string[];
};

/** Connected analytical records. Unknown values stay unknown; don't invent completeness. */
export type KnowledgeRecord = KnowledgeLinks & (
  | { kind: "stakeholder"; name: string; role: string; interests: string; decisionAuthority: string }
  | { kind: "outcome"; description: string; measure: string; baseline?: string; target?: string }
  | { kind: "responsibility"; stakeholderId: string; duty: "responsible" | "accountable" | "consulted" | "informed" }
  | { kind: "evidence"; statement: string; source: string; stakeholderId?: string;
      basis: "testimony" | "connector" | "document" | "assumption"; status: "reported" | "verified" | "disputed" }
  | { kind: "risk"; description: string; impact: string; ownerStakeholderId?: string;
      mitigation: string; status: "open" | "mitigated" | "accepted" }
  | { kind: "tradeoff"; question: string;
      options: { id: string; description: string; benefits: string; costs: string }[];
      selectedOptionId?: string; rationale?: string }
  | { kind: "question"; text: string; stakeholderId: string; dueAt?: number;
      status: "open" | "resolved" | "cancelled"; resolution?: string }
);

/** The current structured knowledge. Its revision changes independently of map-only edits. */
export type ProjectKnowledge = { revision: number; records: KnowledgeRecord[] };

/** Replace a record by ID, or remove it. All references must remain valid after the batch. */
export type KnowledgeOp =
  | { op: "put"; record: KnowledgeRecord }
  | { op: "remove"; id: string };

/** An immutable account submitted through a question-only interview capability. */
export type StakeholderContribution = {
  id: string;
  questionId: string;
  /** Question at submission; absent on older accounts whose original wording was not recorded. */
  questionText?: string;
  stakeholderId: string;
  /** Name recorded at submission; later renames do not rewrite the source. */
  stakeholderName: string;
  /** Participant-supplied request ID; retries cannot create a second account. */
  requestId: string;
  statement: string;
  /** Map revision the interview was opened against, not an assertion of agreement. */
  baselineRevision: number;
  submittedAt: number;
};

/** A durable reason to revisit the investigation. Retries reuse id; consumers must deduplicate. */
export type InvestigationEvent = {
  id: string;
  kind: "reply" | "deadline" | "resumed";
  questionId?: string;
  contributionId?: string;
  /** Interview baseline for a deadline, so reopening a question does not reuse its old work. */
  baselineRevision?: number;
};

/** Documents derived from accepted project knowledge, not separately maintained copies. */
export type ProjectDocumentKind = "brief" | "stakeholders" | "responsibilities" | "risks" | "tradeoffs" | "evidence";

/** Persistent callback to the existing Workshop chat; `self` in executeCode implements this. */
export interface InvestigationHook extends RpcTarget {
  /** Read current context, investigate and propose the next warranted action, once per event ID. */
  onInvestigation(event: InvestigationEvent): Promise<void>;
}

/** Background state, including exhausted deliveries rather than success-shaped defaults. */
export type InvestigationStatus = {
  enabled: boolean;
  pending: number;
  failed: InvestigationEvent[];
};

/** The only data an interview capability reveals. It never exposes other stakeholder accounts. */
export type InterviewContext = {
  projectName: string;
  question: string;
  stakeholderName: string;
  baselineRevision: number;
  /** Only this interview's earlier submitted answers. */
  contributions: StakeholderContribution[];
};

/** A question-only capability. It cannot change the agreed map, resolve questions or read the project. */
export interface ProcessInterview {
  /** Read the assigned question and this interview's answers. */
  getContext(): Promise<InterviewContext>;
  /** Submit attributed testimony. Reuse requestId for a retry; different text with it is rejected. */
  contribute(requestId: string, statement: string): Promise<StakeholderContribution>;
}

/** One process being mapped. */
export interface ProcessProject {
  /** Returns the map, decisions and coverage. Call it before proposing changes. */
  getContext(): Promise<ProjectContext>;

  /**
   * Proposes a change to the map. The person sees it on the map and accepts or rejects it in the
   * chat; this returns once it is queued. Throws if an op is invalid against the current map.
   */
  applyChanges(change: ChangeSet): Promise<ChangeReceipt>;

  /** Returns a bearer resource URL for an open question. Share only with its intended participant. */
  getInterviewUrl(questionId: string): Promise<string>;

  /** Generates Markdown from accepted state only. `responsibilities` is the current RACI matrix. */
  getDocument(kind: ProjectDocumentKind): Promise<string>;

  /**
   * Registers background investigation in this same chat. Pass the persistent `self` received by
   * executeCode, not an ordinary temporary callback. The user must enable the resulting hook in
   * Workshop Connections. Reply and deadline callbacks then survive browser closure.
   */
  watch(callback: InvestigationHook): Promise<void>;
}
