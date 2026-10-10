import type { RpcTarget } from "cloudflare:workers";
import type { Decision, GraphOp, ProcessEdge, ProcessGraph, ProcessLane, ProcessNode } from "./types.js";

/** Who made a change: a person editing the map directly, or an agent change a person accepted. */
export type ChangeSource = "user" | "agent";

/** The project as the map loads it, on open and on resync. */
export type ProjectSnapshot = {
  projectId: string;
  name: string;
  graph: ProcessGraph;
  /** Accepted decisions, newest first. */
  decisions: Decision[];
};

/**
 * How the agent's pending proposals, taken together, would change the map. `added*` are complete
 * elements not yet on the map; the other IDs name elements it already has.
 */
export type PendingPreview = {
  /** Proposals a later edit has overtaken; they no longer apply and should be rejected. */
  conflicts?: string[];
  /** Lanes a proposal adds, in their final order, so a first draft can be shown whole. */
  addedLanes: ProcessLane[];
  addedNodes: ProcessNode[];
  addedEdges: ProcessEdge[];
  removedNodeIds: string[];
  removedEdgeIds: string[];
  changedNodeIds: string[];
  changedEdgeIds: string[];
};

/** A batch of direct map edits, applied atomically. */
export type OpBatch = {
  /** Client-generated ID, echoed to subscribers so the author can recognise its own changes. */
  clientOpId: string;
  /** The revision the edits were made against. */
  baseRevision: number;
  ops: GraphOp[];
};

/** Result of `ProjectHandle.applyOps()`. */
export type ApplyResult =
  | { ok: true; revision: number }
  /** The batch touched an element changed since `baseRevision`, or was invalid. */
  | { ok: false; reason: string; snapshot: ProjectSnapshot };

/** One committed change, pushed to every open map. */
export type ProjectChange = {
  revision: number;
  source: ChangeSource;
  clientOpId?: string;
  ops: GraphOp[];
  /** The decision an accepted agent change recorded. */
  decision?: Decision;
};

/** Receives live changes for an open project. */
export interface ProjectSubscriber {
  /** Called for each commit after the subscription's starting revision, in order. */
  changed(change: ProjectChange): void;
  /** Called instead of `changed` when the changes needed to catch up are no longer kept. */
  reset(snapshot: ProjectSnapshot): void;
}

/**
 * A person's direct-edit capability for one project, from the workspace binding's `openUi()`.
 * Holding it is the authority; it is revoked with the person's workspace access.
 */
export interface ProjectHandle {
  snapshot(): Promise<ProjectSnapshot>;
  /** Applies direct map edits; rejected with a fresh snapshot if they conflict. */
  applyOps(batch: OpBatch): Promise<ApplyResult>;
  /** Streams changes after `fromRevision`. Dispose the returned stub to unsubscribe. */
  subscribe(subscriber: ProjectSubscriber, fromRevision: number): Promise<Disposable>;
  /** Re-places every step in flow order, each in its lane. A no-op if nothing would move. */
  layout(): Promise<ApplyResult>;
  /** How the agent's pending proposals would change the map. */
  previewPending(): Promise<PendingPreview>;
}

/** Marker for RPC targets passed across the binding. */
export type ProjectSubscriberTarget = ProjectSubscriber & RpcTarget;
