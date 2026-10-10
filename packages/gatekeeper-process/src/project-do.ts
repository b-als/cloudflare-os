import { DurableObject, RpcTarget, type RpcStub } from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import { applyGraphOps, GraphOpError, layoutGraph, touchedElementIds } from "./graph-ops.js";
import { Investigation, type InvestigationHookTarget } from "./investigation.js";
import { applyKnowledgeOps, KnowledgeOpError } from "./knowledge.js";
import type { HookInitiator } from "@gadgets/workshop-shared/gatekeeper";
import type { ChangeSet, Decision, GraphOp, InterviewContext, ProcessGraph, ProjectContext, StakeholderContribution } from "./types.js";
import type {
  ApplyResult,
  ChangeSource,
  OpBatch,
  ProjectChange,
  ProjectSnapshot,
  ProjectSubscriberTarget,
} from "./ui-types.js";

/** An accepted agent change; `decisionId` was assigned when it was proposed. */
export type AgentChangeInput = ChangeSet & { decisionId: string };

/** What a `process://new` binding needs to create its project on first claim. */
export type NewProjectInput = {
  projectId: string;
  name: string;
  creatorAccountId: string;
  sharingDomain: string;
};

type SubscriberStub = RpcStub<ProjectSubscriberTarget>;

/** Changes kept for catching up an open map; an older subscriber gets a full snapshot instead. */
export const CHANGE_LOG_LIMIT = 500;
export const MAX_PROJECT_NAME_LENGTH = 120;
export const MAX_SUMMARY_LENGTH = 200;
export const MAX_RATIONALE_LENGTH = 4000;
export const MAX_CLIENT_OP_ID_LENGTH = 128;

const NOT_FOUND = "Project not found or you do not have access.";

// Fresh table names, so a project stored by the retired ten-stage model (`meta`, `lanes`, ...) is
// never read as this one; `#importRetiredModel` carries its map across instead.
const SCHEMA = `
CREATE TABLE project_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  project_id TEXT NOT NULL,
  sharing_domain TEXT NOT NULL,
  name TEXT NOT NULL,
  creator_account_id TEXT NOT NULL,
  claimed_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  graph TEXT NOT NULL,
  element_revisions TEXT NOT NULL
);
CREATE TABLE decision_log (
  decision_id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  rationale TEXT NOT NULL,
  node_ids TEXT NOT NULL,
  edge_ids TEXT NOT NULL,
  decided_at INTEGER NOT NULL
);
CREATE TABLE change_log (revision INTEGER PRIMARY KEY, change TEXT NOT NULL);
`;

type State = {
  projectId: string;
  sharingDomain: string;
  name: string;
  creatorAccountId: string;
  claimedBy: string | null;
  revision: number;
  /** The map without its revision, which lives in `revision`. */
  graph: Omit<ProcessGraph, "revision">;
  /** The revision that last changed each node (`n:<id>`) and edge (`e:<id>`), for conflict checks. */
  elementRevisions: Record<string, number>;
};

/** Disposing the last stub to this removes one subscriber. */
class Subscription extends RpcTarget {
  readonly #onDispose: () => void;

  constructor(onDispose: () => void) {
    super();
    this.#onDispose = onDispose;
  }

  [Symbol.dispose](): void {
    this.#onDispose();
  }
}

/**
 * One process project, and the only writer of its map and decision log. It holds no per-user
 * authority: its callers are this Worker's code, gated by the workspace binding that claimed it.
 */
@validateRpc()
export class ProcessProjectDO extends DurableObject<Cloudflare.Env> {
  readonly #sql: SqlStorage;
  readonly #subscribers = new Set<SubscriberStub>();
  readonly #investigation: Investigation;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.#sql = ctx.storage.sql;
    this.#investigation = new Investigation(ctx.storage);
  }

  /** The creating account's ID, or null if the project does not exist. */
  creatorAccountId(): string | null {
    return this.#read()?.creatorAccountId ?? null;
  }

  /**
   * Links the project to `workspaceId`, creating it from `create` first if it doesn't exist yet.
   * Idempotent for the claiming workspace; throws for any other.
   */
  claim(workspaceId: string, create?: NewProjectInput): void {
    let state = this.#read();
    if (!state) {
      if (!create) throw new Error(NOT_FOUND);
      state = this.#create(create);
    }
    if (state.claimedBy === workspaceId) return;
    if (state.claimedBy !== null) throw new Error("This project is already linked to another workspace.");
    this.#sql.exec("UPDATE project_state SET claimed_by = ? WHERE id = 1", workspaceId);
  }

  snapshot(): ProjectSnapshot {
    const state = this.#require();
    const graph = { ...state.graph, revision: state.revision };
    return { projectId: state.projectId, name: state.name, graph, decisions: this.#decisions(graph) };
  }

  /** A consistent accepted-state read; pending proposals are overlaid by the binding facet. */
  context(): Omit<ProjectContext, "coverage"> {
    const snapshot = this.snapshot();
    return {
      name: snapshot.name, graph: snapshot.graph, decisions: snapshot.decisions,
      knowledge: this.#investigation.knowledge(), contributions: this.#investigation.contributions(),
      investigation: this.#investigation.status(),
    };
  }

  /** Bearer resource for one open question; never returned to an interview session. */
  interviewUrl(questionId: string): string {
    return this.#investigation.interviewUrl(this.#require().projectId, questionId);
  }

  /** Rechecks the question's revocable capability on every read. */
  interviewContext(questionId: string, token: string): InterviewContext {
    return this.#investigation.interviewContext(questionId, token, this.#require().name);
  }

  /** Validates and prepares an immutable reply without publishing it before approval. */
  prepareContribution(questionId: string, token: string, requestId: string, statement: string): StakeholderContribution {
    return this.#investigation.prepareContribution(questionId, token, requestId, statement, this.#require().name);
  }

  /** Publishes approved testimony, without changing the map or settling the question. */
  async contribute(questionId: string, token: string, contribution: StakeholderContribution): Promise<void> {
    this.#require();
    this.#investigation.contribute(questionId, token, contribution);
    await this.#investigation.schedule();
  }

  /** Installs only a Workshop-controlled initiator, not a session-bound callback. */
  async setInvestigationWatch(id: string, initiator: Fetcher<HookInitiator<InvestigationHookTarget>> | null): Promise<void> {
    this.#require();
    await this.#investigation.setWatch(id, initiator);
  }

  /** Durable wake-up delivery, independent of browser and model request lifetimes. */
  async alarm(): Promise<void> {
    await this.#investigation.alarm();
  }

  /**
   * Applies a person's direct edits. A batch conflicts only if it touches a step or flow that changed
   * after `baseRevision`, so people (and accepted agent changes) can edit different parts at once.
   */
  applyOps(batch: OpBatch, source: ChangeSource): ApplyResult {
    if (typeof batch.clientOpId !== "string" || batch.clientOpId.length === 0 ||
        batch.clientOpId.length > MAX_CLIENT_OP_ID_LENGTH) {
      throw new TypeError(`clientOpId must be 1-${MAX_CLIENT_OP_ID_LENGTH} characters.`);
    }
    const state = this.#require();
    const reject = (reason: string): ApplyResult => ({ ok: false, reason, snapshot: this.snapshot() });
    if (!Number.isInteger(batch.baseRevision) || batch.baseRevision < 0 || batch.baseRevision > state.revision) {
      return reject(`Revision ${batch.baseRevision} is not a known revision (current is ${state.revision}).`);
    }
    if (batch.ops.length === 0) return reject("A batch must contain at least one edit.");
    const graph = { ...state.graph, revision: state.revision };
    const touched = touchedElementIds(batch.ops, graph);
    const stale = [
      ...touched.nodeIds.map((id) => `n:${id}`),
      ...touched.edgeIds.map((id) => `e:${id}`),
    ].find((key) => (state.elementRevisions[key] ?? 0) > batch.baseRevision);
    if (stale) return reject("Someone else changed this part of the map first.");
    let next: ProcessGraph;
    try {
      next = applyGraphOps(graph, batch.ops);
      applyKnowledgeOps(this.#investigation.knowledge(), [], next);
    } catch (error) {
      if (error instanceof GraphOpError || error instanceof KnowledgeOpError) return reject(error.message);
      throw error;
    }
    const revision = this.#commit(state, next, { revision: state.revision + 1, source, clientOpId: batch.clientOpId, ops: batch.ops });
    return { ok: true, revision };
  }

  /**
   * Applies an agent change the person accepted, recording it as a decision. Throws if it no longer
   * applies, for example because someone deleted a step it builds on.
   */
  async applyAgentChange(input: AgentChangeInput): Promise<Decision> {
    const state = this.#require();
    const already = this.#decisions({ ...state.graph, revision: state.revision }).find((decision) => decision.decisionId === input.decisionId);
    if (already) {
      await this.#investigation.schedule();
      return already;
    }
    const summary = requireText(input.summary, "Summary", MAX_SUMMARY_LENGTH);
    const rationale = requireText(input.rationale, "Rationale", MAX_RATIONALE_LENGTH);
    const graph = { ...state.graph, revision: state.revision };
    const knowledge = this.#investigation.knowledge();
    if (input.knowledgeOps?.length && input.knowledgeRevision !== knowledge.revision) {
      throw new Error("Project knowledge changed after this proposal. Read it again and propose a fresh synthesis.");
    }
    let next: ProcessGraph;
    try {
      next = applyGraphOps(graph, input.ops);
    } catch (error) {
      if (error instanceof GraphOpError) {
        throw new Error(`This change no longer applies to the map: ${error.message}`, { cause: error });
      }
      throw error;
    }
    const nextKnowledge = applyKnowledgeOps(knowledge, input.knowledgeOps ?? [], next);
    const touched = touchedElementIds(input.ops, graph);
    const decision: Decision = {
      decisionId: input.decisionId,
      summary,
      rationale,
      nodeIds: touched.nodeIds.filter((id) => next.nodes.some((node) => node.id === id)),
      edgeIds: touched.edgeIds.filter((id) => next.edges.some((edge) => edge.id === id)),
      decidedAt: Date.now(),
    };
    const change: ProjectChange = { revision: state.revision + 1, source: "agent", ops: input.ops, decision };
    this.ctx.storage.transactionSync(() => {
      this.#sql.exec(
        `INSERT INTO decision_log (decision_id, summary, rationale, node_ids, edge_ids, decided_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        decision.decisionId, summary, rationale, JSON.stringify(decision.nodeIds),
        JSON.stringify(decision.edgeIds), decision.decidedAt,
      );
      this.#write(state, next, change);
      if (input.knowledgeOps?.length) this.#investigation.writeKnowledge(nextKnowledge, change.revision);
    });
    this.#publish(change);
    await this.#investigation.schedule();
    return decision;
  }

  /** Re-places every step in flow order. A no-op, at the current revision, if nothing would move. */
  layout(): ApplyResult {
    const state = this.#require();
    const graph = { ...state.graph, revision: state.revision };
    const before = new Map(graph.nodes.map((node) => [node.id, node]));
    const ops: GraphOp[] = layoutGraph(graph).nodes
      .filter((node) => before.get(node.id)?.x !== node.x || before.get(node.id)?.y !== node.y)
      .map((node) => ({ op: "moveNode", id: node.id, x: node.x, y: node.y }));
    if (ops.length === 0) return { ok: true, revision: state.revision };
    const revision = this.#commit(state, applyGraphOps(graph, ops), { revision: state.revision + 1, source: "user", ops });
    return { ok: true, revision };
  }

  /** Streams every change after `fromRevision`, or a full snapshot if those are no longer kept. */
  @skipRpcValidation()
  subscribe(subscriber: SubscriberStub, fromRevision: number): Subscription {
    const state = this.#require();
    const own = subscriber.dup();
    this.#subscribers.add(own);
    const oldest = this.#sql.exec<{ lo: number | null }>("SELECT MIN(revision) AS lo FROM change_log").one().lo;
    const replayable = Number.isInteger(fromRevision) && fromRevision >= 0 && fromRevision <= state.revision &&
      (fromRevision === state.revision || (oldest !== null && oldest <= fromRevision + 1));
    if (!replayable) {
      this.#deliver(own, own.reset(this.snapshot()));
    } else {
      for (const row of this.#sql.exec<{ change: string }>(
        "SELECT change FROM change_log WHERE revision > ? ORDER BY revision", fromRevision,
      )) {
        this.#deliver(own, own.changed(JSON.parse(row.change) as ProjectChange));
      }
    }
    return new Subscription(() => this.#drop(own));
  }

  #create(input: NewProjectInput): State {
    const name = requireText(input.name, "Project name", MAX_PROJECT_NAME_LENGTH);
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.#sql.exec(SCHEMA);
      this.#sql.exec(
        `INSERT INTO project_state (id, project_id, sharing_domain, name, creator_account_id, claimed_by,
           created_at, updated_at, revision, graph, element_revisions)
         VALUES (1, ?, ?, ?, ?, NULL, ?, ?, 0, ?, '{}')`,
        input.projectId, input.sharingDomain, name, input.creatorAccountId, now, now,
        JSON.stringify({ lanes: [], nodes: [], edges: [] }),
      );
    });
    return this.#read()!;
  }

  // Writes a new map as `change.revision` and logs the change. Callers run it inside their
  // transaction and `#publish` afterwards, so a map never hears of a change that didn't commit.
  #write(state: State, next: ProcessGraph, change: ProjectChange): void {
    const touched = touchedElementIds(change.ops, state.graph);
    const elementRevisions = { ...state.elementRevisions };
    for (const id of touched.nodeIds) {
      if (next.nodes.some((node) => node.id === id)) elementRevisions[`n:${id}`] = change.revision;
      else delete elementRevisions[`n:${id}`];
    }
    for (const id of touched.edgeIds) {
      if (next.edges.some((edge) => edge.id === id)) elementRevisions[`e:${id}`] = change.revision;
      else delete elementRevisions[`e:${id}`];
    }
    const { revision: _revision, ...graph } = next;
    this.#sql.exec(
      "UPDATE project_state SET revision = ?, updated_at = ?, graph = ?, element_revisions = ? WHERE id = 1",
      change.revision, Date.now(), JSON.stringify(graph), JSON.stringify(elementRevisions),
    );
    this.#sql.exec("INSERT INTO change_log (revision, change) VALUES (?, ?)", change.revision, JSON.stringify(change));
    this.#sql.exec("DELETE FROM change_log WHERE revision <= ?", change.revision - CHANGE_LOG_LIMIT);
  }

  #publish(change: ProjectChange): void {
    for (const subscriber of this.#subscribers) this.#deliver(subscriber, subscriber.changed(change));
  }

  // The common path: write one change in its own transaction, then publish it.
  #commit(state: State, next: ProcessGraph, change: ProjectChange): number {
    this.ctx.storage.transactionSync(() => this.#write(state, next, change));
    this.#publish(change);
    return change.revision;
  }

  // Decisions newest first, naming only the elements that still exist.
  #decisions(graph: ProcessGraph): Decision[] {
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const edgeIds = new Set(graph.edges.map((edge) => edge.id));
    return this.#sql.exec<{
      decision_id: string; summary: string; rationale: string; node_ids: string; edge_ids: string; decided_at: number;
    }>("SELECT * FROM decision_log ORDER BY decided_at DESC, rowid DESC").toArray().map((row) => ({
      decisionId: row.decision_id,
      summary: row.summary,
      rationale: row.rationale,
      nodeIds: (JSON.parse(row.node_ids) as string[]).filter((id) => nodeIds.has(id)),
      edgeIds: (JSON.parse(row.edge_ids) as string[]).filter((id) => edgeIds.has(id)),
      decidedAt: row.decided_at,
    }));
  }

  #read(): State | undefined {
    if (!this.#hasTable("project_state") && !this.#importRetiredModel()) return undefined;
    const row = this.#sql.exec<{
      project_id: string; sharing_domain: string; name: string; creator_account_id: string;
      claimed_by: string | null; revision: number; graph: string; element_revisions: string;
    }>("SELECT * FROM project_state WHERE id = 1").toArray()[0];
    if (!row) return undefined;
    return {
      projectId: row.project_id,
      sharingDomain: row.sharing_domain,
      name: row.name,
      creatorAccountId: row.creator_account_id,
      claimedBy: row.claimed_by,
      revision: row.revision,
      graph: JSON.parse(row.graph) as State["graph"],
      elementRevisions: JSON.parse(row.element_revisions) as Record<string, number>,
    };
  }

  #require(): State {
    const state = this.#read();
    if (!state) throw new Error(NOT_FOUND);
    return state;
  }

  #hasTable(name: string): boolean {
    return this.#sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", name).toArray().length > 0;
  }

  #deliver(subscriber: SubscriberStub, call: Promise<unknown>): void {
    call.catch(() => this.#drop(subscriber));
  }

  #drop(subscriber: SubscriberStub): void {
    if (this.#subscribers.delete(subscriber)) subscriber[Symbol.dispose]();
  }

  /**
   * Carries a project stored by the retired ten-stage model across, on first read: its map (lanes,
   * steps and flows) and its accepted decisions. Nothing else of that model survives. Returns whether
   * there was one. Delete this once no deployment holds projects from before the chat-first rebuild.
   */
  #importRetiredModel(): boolean {
    if (!this.#hasTable("meta")) return false;
    const meta = this.#sql.exec<{
      project_id: string; sharing_domain: string; name: string; creator_account_id: string;
      claimed_by: string | null; created_at: number; updated_at: number; revision: number;
    }>("SELECT * FROM meta WHERE id = 1").toArray()[0];
    if (!meta) return false;
    const lanes = this.#sql.exec<{ id: string; label: string }>("SELECT id, label FROM lanes ORDER BY position")
      .toArray().map(({ id, label }) => ({ id, label }));
    const nodes = this.#sql.exec("SELECT * FROM nodes").toArray().map((row) => {
      const text = (key: string) => typeof row[key] === "string" && row[key] !== "" ? row[key] as string : undefined;
      const list = (key: string) => typeof row[key] === "string" ? JSON.parse(row[key] as string) as string[] : undefined;
      const node: Record<string, unknown> = {
        id: row.id, type: row.type, label: row.label, laneId: row.lane_id, x: row.x, y: row.y,
        description: text("description"), owner: text("owner"), system: text("system"),
        inputs: list("inputs"), outputs: list("outputs"), painPoints: text("pain_points"),
        duration: typeof row.duration_amount === "number" && typeof row.duration_unit === "string"
          ? { amount: row.duration_amount, unit: row.duration_unit } : undefined,
      };
      return Object.fromEntries(Object.entries(node).filter(([, value]) => value !== undefined));
    });
    const edges = this.#sql.exec("SELECT * FROM edges").toArray().map((row) =>
      row.label ? { id: row.id, source: row.source, target: row.target, label: row.label }
        : { id: row.id, source: row.source, target: row.target });
    const decisions = this.#hasTable("decisions")
      ? this.#sql.exec("SELECT * FROM decisions").toArray()
        .filter((row) => (row.model ?? "asIs") === "asIs" && (row.status ?? "active") === "active")
      : [];
    this.ctx.storage.transactionSync(() => {
      this.#sql.exec(SCHEMA);
      this.#sql.exec(
        `INSERT INTO project_state (id, project_id, sharing_domain, name, creator_account_id, claimed_by,
           created_at, updated_at, revision, graph, element_revisions)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
        meta.project_id, meta.sharing_domain, meta.name, meta.creator_account_id, meta.claimed_by,
        meta.created_at, meta.updated_at, meta.revision, JSON.stringify({ lanes, nodes, edges }),
      );
      for (const row of decisions) {
        this.#sql.exec(
          `INSERT INTO decision_log (decision_id, summary, rationale, node_ids, edge_ids, decided_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          row.decision_id, row.summary, row.rationale, row.node_ids, row.edge_ids, row.decided_at,
        );
      }
    });
    return true;
  }
}

function requireText(value: string, what: string, max: number): string {
  if (typeof value !== "string") throw new TypeError(`${what} must be text.`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${what} must not be empty.`);
  if (trimmed.length > max) throw new Error(`${what} must be at most ${max} characters.`);
  return trimmed;
}
