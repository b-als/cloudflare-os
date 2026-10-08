import type {
  Decision,
  GraphOp,
  OpenQuestion,
  ProcessEdge,
  ProcessGraph,
  ProcessNode,
  Stakeholder,
  StakeholderInput,
} from "./types.js";

/** Who made a change: a stakeholder editing directly, or an agent change they accepted. */
export type ChangeSource = "user" | "agent";

/** Full project state the canvas loads on open and on resync. */
export type ProjectSnapshot = {
  projectId: string;
  name: string;
  graph: ProcessGraph;
  decisions: Decision[];
  openQuestions: OpenQuestion[];
  stakeholders: Stakeholder[];
  /** Who the agent should interview next; null when unset. */
  interviewTargetStakeholderId: string | null;
};

/**
 * How the project's pending agent proposals, taken together, would change the committed graph.
 * `added*` are fully-formed and not yet part of the committed graph; the other IDs refer to
 * elements the committed graph already has.
 */
export type PendingPreview = {
  addedNodes: ProcessNode[];
  addedEdges: ProcessEdge[];
  removedNodeIds: string[];
  removedEdgeIds: string[];
  changedNodeIds: string[];
  changedEdgeIds: string[];
  /** Questions a pending proposal would raise, not yet in the committed open-question list. */
  proposedQuestions: OpenQuestion[];
};


/** A batch of direct canvas edits, applied atomically. */
export type OpBatch = {
  /** Client-generated ID, echoed to subscribers so the author can ignore its own changes. */
  clientOpId: string;
  /** Revision the client's edits were made against. */
  baseRevision: number;
  ops: GraphOp[];
};

/** Result of `ProjectHandle.applyOps()`. */
export type ApplyResult =
  | { ok: true; revision: number }
  /** The batch touched an element changed or deleted since `baseRevision`, or was invalid. */
  | { ok: false; reason: string; snapshot: ProjectSnapshot };

/** One committed change pushed to subscribers. */
export type ProjectChange = {
  revision: number;
  source: ChangeSource;
  clientOpId?: string;
  ops: GraphOp[];
  /** The decision this change recorded, as recorded. */
  decision?: Decision;
  /** Decisions this change marked superseded by `decision`. */
  supersededDecisionIds?: string[];
  /** The question this change raised. */
  questionRaised?: OpenQuestion;
  /** The question this change resolved. */
  questionResolved?: { questionId: string; answer: string };
  /** A stakeholder register entry created or updated by this change. */
  stakeholderUpserted?: Stakeholder;
  /** A stakeholder removed from the register by this change. */
  stakeholderRemoved?: { stakeholderId: string };
  /** The interview target after this change (`null` clears it). */
  interviewTargetChanged?: { stakeholderId: string | null };
};

/** Receives live changes for an open project. */
export interface ProjectSubscriber {
  /** Called for each commit after the subscription's starting revision, in order. */
  changed(change: ProjectChange): void;
  /** Called instead of `changed` when the history needed to catch up was trimmed. */
  reset(snapshot: ProjectSnapshot): void;
}

/**
 * A user's direct-edit capability for one project, from the workspace binding's `openUi()`.
 * Holding it is the authority; it is revoked with the user's workspace access.
 */
export interface ProjectHandle {
  snapshot(): Promise<ProjectSnapshot>;
  /**
   * Applies direct canvas edits. Rejected with a fresh snapshot on conflict or if an op other than
   * `moveNode` touches an element locked by an active decision.
   */
  applyOps(batch: OpBatch): Promise<ApplyResult>;
  /** Streams changes after `fromRevision`. Dispose the returned stub to unsubscribe. */
  subscribe(subscriber: ProjectSubscriber, fromRevision: number): Promise<Disposable>;
  /**
   * Locks the given elements under a new decision. Superseding decisions is the only way to
   * unlock elements: those not in the new decision's scope become editable.
   */
  recordDecision(decision: {
    summary: string;
    rationale: string;
    nodeIds: string[];
    edgeIds: string[];
    supersedes?: string[];
  }): Promise<Decision>;
  /** Marks an open question answered. */
  resolveQuestion(questionId: string, answer: string): Promise<void>;
  /** Creates or updates a stakeholder register entry. */
  upsertStakeholder(input: StakeholderInput): Promise<Stakeholder>;
  /** Removes a stakeholder from the register. */
  removeStakeholder(stakeholderId: string): Promise<void>;
  /** Sets who the agent should interview next, or `null` to clear. */
  setInterviewTarget(stakeholderId: string | null): Promise<void>;
  /**
   * Recomputes every step's position from the flow, keeping each step in its lane. Returns like
   * `applyOps`; a no-op (revision unchanged) if positions already match.
   */
  layout(): Promise<ApplyResult>;
  /** How the project's currently pending agent proposals would change the graph, for preview. */
  previewPending(): Promise<PendingPreview>;
}
