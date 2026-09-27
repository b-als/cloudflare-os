import type {
  Decision,
  GraphOp,
  OpenQuestion,
  ProcessGraph,
  ProjectSummary,
} from "./types.js";

/** Who made a change: a stakeholder editing directly, or an agent change they accepted. */
export type ChangeSource = "user" | "agent";

/** Project role; enforced when minting a `ProjectHandle` and on each mutation. */
export type ProjectRole = "owner" | "editor" | "viewer";

/** Full project state the canvas loads on open and on resync. */
export type ProjectSnapshot = {
  projectId: string;
  name: string;
  role: ProjectRole;
  graph: ProcessGraph;
  decisions: Decision[];
  openQuestions: OpenQuestion[];
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
  /** Present when the change recorded or superseded a decision. */
  decision?: Decision;
};

/** Receives live changes for an open project. */
export interface ProjectSubscriber {
  /** Called for each commit after the subscription's starting revision, in order. */
  changed(change: ProjectChange): void;
  /** Called instead of `changed` when the history needed to catch up was trimmed. */
  reset(snapshot: ProjectSnapshot): void;
}

/** Capability for one project, minted only for members. */
export interface ProjectHandle {
  snapshot(): Promise<ProjectSnapshot>;
  /** Applies direct canvas edits. Rejected with a fresh snapshot on conflict. Viewers cannot edit. */
  applyOps(batch: OpBatch): Promise<ApplyResult>;
  /** Streams changes after `fromRevision`. Dispose the returned stub to unsubscribe. */
  subscribe(subscriber: ProjectSubscriber, fromRevision: number): Promise<Disposable>;
  /** Locks the given elements under a new decision; owners and editors only. */
  recordDecision(decision: {
    summary: string;
    rationale: string;
    nodeIds: string[];
    edgeIds: string[];
    supersedes?: string[];
  }): Promise<Decision>;
  /** Marks an open question answered. */
  resolveQuestion(questionId: string, answer: string): Promise<void>;
  /** Mints a single-use invite key granting `role`. Owners only. */
  createInvite(role: Exclude<ProjectRole, "owner">): Promise<{ inviteKey: string }>;
}

/** The Process Studio management capability handed to the Workshop frontend. */
export interface ProcessStudioApi {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(name: string): Promise<ProjectSummary>;
  /** Throws if the project does not exist or the caller is not a member. */
  openProject(projectId: string): Promise<ProjectHandle>;
  /** Redeems an invite key, adding the caller as a member. */
  joinProject(inviteKey: string): Promise<ProjectSummary>;
}
