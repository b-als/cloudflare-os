import type {
  BaBaseline,
  BaLifecycle,
  Decision,
  GraphOp,
  LifecycleOp,
  OpenQuestion,
  ProcessEdge,
  ProcessGraph,
  ProcessModel,
  ProcessNode,
  Stakeholder,
  StakeholderInput,
  Takeaway,
  TakeawayInput,
} from "./types.js";
import type { RpcTarget } from "cloudflare:workers";

/** Who made a change: a stakeholder editing directly, or an agent change they accepted. */
export type ChangeSource = "user" | "agent";

/** Full project state the canvas loads on open and on resync. */
export type ProjectSnapshot = {
  /** Absent only in snapshots produced by older clients. */
  lifecycle?: BaLifecycle;
  projectId: string;
  name: string;
  graph: ProcessGraph;
  decisions: Decision[];
  openQuestions: OpenQuestion[];
  stakeholders: Stakeholder[];
  /** Who the agent should interview next; null when unset. */
  interviewTargetStakeholderId: string | null;
  /** Captured as-is / to-be notes, requirements, and pain points. */
  takeaways: Takeaway[];
};

/**
 * How the project's pending agent proposals, taken together, would change the committed graph.
 * `added*` are fully-formed and not yet part of the committed graph; the other IDs refer to
 * elements the committed graph already has.
 */
export type PendingPreview = {
  /** Earlier proposals overtaken by committed edits; they must be revised or rejected. */
  conflicts?: string[];
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
  /** Replacement lifecycle state, when artifacts, the target model, or reviews changed. */
  lifecycle?: BaLifecycle;
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
  /** A takeaway created or updated by this change. */
  takeawayUpserted?: Takeaway;
  /** A takeaway removed by this change. */
  takeawayRemoved?: { takeawayId: string };
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
  /** Apply a revision-checked artifact/target-model batch. Throws on invalid edits or conflicts. */
  applyLifecycle(batch: {
    clientOpId: string;
    baseRevision: number;
    ops: LifecycleOp[];
    modelOps?: GraphOp[];
  }): Promise<ProjectSnapshot>;
  /** Capture immutable content for review. Throws if the project changed since baseRevision. */
  createBaseline(baseRevision: number): Promise<BaBaseline>;
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
    model?: ProcessModel;
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
  /** Creates or updates a takeaway (as-is / to-be / requirement / pain point). */
  upsertTakeaway(input: TakeawayInput): Promise<Takeaway>;
  /** Removes a takeaway. */
  removeTakeaway(takeawayId: string): Promise<void>;
  /**
   * Recomputes every step's position from the flow, keeping each step in its lane. Returns like
   * `applyOps`; a no-op (revision unchanged) if positions already match.
   */
  layout(): Promise<ApplyResult>;
  /** How the project's currently pending agent proposals would change the graph, for preview. */
  previewPending(model?: ProcessModel): Promise<PendingPreview>;
}

/** Owner-only review capability, deliberately separate from agent and shared edit capabilities. */
export interface ProjectReview extends RpcTarget {
  /** Review one immutable baseline. An approved baseline must have no completeness blockers. */
  reviewBaseline(id: string, decision: "approved" | "rejected", note: string): Promise<void>;
}

/** The authenticated account's management capability; project ownership is checked when opened. */
export interface ProcessAccountUi extends RpcTarget {
  /** Mint a review capability only for a project created by this connected account. */
  getProjectReview(projectId: string): Promise<ProjectReview>;
}
