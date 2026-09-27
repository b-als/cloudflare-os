import { DurableObject } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import { createLogger } from "@gadgets/backend-utils/logger";
import { domainName } from "./domain.js";
import { applyGraphOps, GraphOpError, touchedElementIds } from "./graph-ops.js";
import type {
  Decision,
  OpenQuestion,
  ProcessEdge,
  ProcessGraph,
  ProcessLane,
  ProcessNode,
  ProcessNodeType,
  ProjectSummary,
} from "./types.js";
import type {
  ApplyResult,
  ChangeSource,
  OpBatch,
  ProjectHandle,
  ProjectRole,
  ProjectSnapshot,
} from "./ui-types.js";

/** Input to `recordDecision`, identical to the UI-facing handle's argument. */
export type DecisionInput = Parameters<ProjectHandle["recordDecision"]>[0];

export const OP_LOG_LIMIT = 500;
export const MAX_PROJECT_NAME_LENGTH = 120;
export const MAX_SUMMARY_LENGTH = 200;
export const MAX_RATIONALE_LENGTH = 4000;
export const MAX_QUESTION_LENGTH = 2000;
export const MAX_ANSWER_LENGTH = 4000;
export const MAX_CLIENT_OP_ID_LENGTH = 128;
export const MAX_REFERENCED_IDS = 500;

const ACCESS_DENIED = "Project not found or you do not have access.";

type ProcessLogFields = { vendorId: string; projectId: string };
const logger = createLogger<ProcessLogFields>({ component: "gatekeeper.process", vendorId: "process" });

type Meta = {
  projectId: string;
  sharingDomain: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
};

type DecisionRow = {
  decision_id: string;
  summary: string;
  rationale: string;
  node_ids: string;
  edge_ids: string;
  status: string;
  superseded_by: string | null;
  decided_at: number;
};

const SCHEMA = `
CREATE TABLE meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  project_id TEXT NOT NULL,
  sharing_domain TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL
);
CREATE TABLE lanes (id TEXT PRIMARY KEY, label TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  lane_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  modified_revision INTEGER NOT NULL
);
CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  label TEXT,
  modified_revision INTEGER NOT NULL
);
CREATE TABLE members (account_id TEXT PRIMARY KEY, role TEXT NOT NULL, joined_at INTEGER NOT NULL);
CREATE TABLE decisions (
  decision_id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  rationale TEXT NOT NULL,
  node_ids TEXT NOT NULL,
  edge_ids TEXT NOT NULL,
  status TEXT NOT NULL,
  superseded_by TEXT,
  decided_at INTEGER NOT NULL,
  decided_by TEXT NOT NULL
);
CREATE TABLE questions (
  question_id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  node_ids TEXT NOT NULL,
  raised_at INTEGER NOT NULL,
  raised_by TEXT NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT,
  answer TEXT
);
CREATE TABLE ops_log (
  revision INTEGER PRIMARY KEY,
  client_op_id TEXT,
  actor_account_id TEXT NOT NULL,
  source TEXT NOT NULL,
  ops_json TEXT NOT NULL,
  decision_id TEXT,
  at INTEGER NOT NULL
);
`;

/** One process project: the sole writer of its graph, members, decisions, and questions. */
@validateRpc()
export class ProcessProjectDO extends DurableObject<Cloudflare.Env> {
  readonly #sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.#sql = ctx.storage.sql;
  }

  /** Creates the project with `ownerAccountId` as its owner. Throws if already initialized. */
  init(
    projectId: string,
    name: string,
    ownerAccountId: string,
    sharingDomain: string,
  ): ProjectSummary {
    if (this.#initialized()) throw new Error("Project already exists.");
    const cleanName = requireText(name, "Project name", MAX_PROJECT_NAME_LENGTH);
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.#sql.exec(SCHEMA);
      this.#sql.exec(
        `INSERT INTO meta (id, project_id, sharing_domain, name, created_at, updated_at, revision)
         VALUES (1, ?, ?, ?, ?, ?, 0)`,
        projectId, sharingDomain, cleanName, now, now,
      );
      this.#sql.exec(
        "INSERT INTO members (account_id, role, joined_at) VALUES (?, 'owner', ?)",
        ownerAccountId, now,
      );
    });
    return { projectId, name: cleanName, updatedAt: now };
  }

  /** Returns the caller's role, or null for non-members and missing projects. */
  memberRole(accountId: string): ProjectRole | null {
    return this.#initialized() ? this.#roleOf(accountId) : null;
  }

  /** Adds or re-roles a member. Callers are trusted in-worker code that has authorized the grant. */
  async addMember(accountId: string, role: ProjectRole): Promise<void> {
    this.#requireMeta();
    this.#sql.exec(
      `INSERT INTO members (account_id, role, joined_at) VALUES (?, ?, ?)
       ON CONFLICT (account_id) DO UPDATE SET role = excluded.role`,
      accountId, role, Date.now(),
    );
    await this.#publishSummary([accountId]);
  }

  /** Removes a member; deletes the project once no members remain. */
  async removeMember(accountId: string): Promise<void> {
    if (!this.#initialized()) return;
    this.#sql.exec("DELETE FROM members WHERE account_id = ?", accountId);
    const remaining = this.#sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM members").one().n;
    if (remaining === 0) await this.ctx.storage.deleteAll();
  }

  /** Full project state for a member. */
  snapshot(accountId: string): ProjectSnapshot {
    return this.#snapshot(this.#requireRole(accountId));
  }

  /** Applies a direct canvas batch with per-element optimistic concurrency. */
  async applyOps(accountId: string, batch: OpBatch): Promise<ApplyResult> {
    const role = this.#requireRole(accountId);
    if (role === "viewer") throw new Error("Viewers cannot edit this project.");
    if (typeof batch.clientOpId !== "string" || batch.clientOpId.length === 0 ||
        batch.clientOpId.length > MAX_CLIENT_OP_ID_LENGTH) {
      throw new TypeError(`clientOpId must be 1-${MAX_CLIENT_OP_ID_LENGTH} characters.`);
    }
    const meta = this.#requireMeta();
    const reject = (reason: string): ApplyResult => ({
      ok: false, reason, snapshot: this.#snapshot(role),
    });
    const base = batch.baseRevision;
    if (!Number.isInteger(base) || base < 0 || base > meta.revision) {
      return reject(`Base revision ${base} is not a known revision (current is ${meta.revision}).`);
    }
    if (batch.ops.length === 0) return reject("A batch must contain at least one op.");

    const graph = this.#readGraph(meta.revision);
    const locks = this.#locks();
    let next: ProcessGraph;
    try {
      next = applyGraphOps(graph, batch.ops, {
        lockedNodeIds: locks.nodeIds,
        lockedEdgeIds: locks.edgeIds,
        allowLocked: role === "owner",
      });
    } catch (error) {
      if (error instanceof GraphOpError) return reject(error.message);
      throw error;
    }
    const conflict = this.#findConflict(batch, graph);
    if (conflict) return reject(conflict);

    const revision = meta.revision + 1;
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.#writeGraph(graph, next, revision);
      this.#commit(revision, now, {
        clientOpId: batch.clientOpId, accountId, source: "user", opsJson: JSON.stringify(batch.ops),
      });
    });
    await this.#publishSummary();
    return { ok: true, revision };
  }

  /** Records a decision locking the given elements, superseding the listed active decisions. */
  async recordDecision(accountId: string, input: DecisionInput): Promise<Decision> {
    this.#requireEditor(accountId);
    const meta = this.#requireMeta();
    const summary = requireText(input.summary, "Summary", MAX_SUMMARY_LENGTH);
    const rationale = requireText(input.rationale, "Rationale", MAX_RATIONALE_LENGTH, true);
    const nodeIds = this.#requireExisting("nodes", input.nodeIds, "Node");
    const edgeIds = this.#requireExisting("edges", input.edgeIds, "Edge");
    const supersedes = uniqueIds(input.supersedes ?? [], "supersedes");
    for (const decisionId of supersedes) {
      const row = this.#sql.exec<{ status: string }>(
        "SELECT status FROM decisions WHERE decision_id = ?", decisionId,
      ).toArray()[0];
      if (row?.status !== "active") {
        throw new Error(`Decision "${decisionId}" is not an active decision.`);
      }
    }
    const decision: Decision = {
      decisionId: crypto.randomUUID(),
      summary,
      rationale,
      nodeIds,
      edgeIds,
      status: "active",
      decidedAt: Date.now(),
    };
    const revision = meta.revision + 1;
    this.ctx.storage.transactionSync(() => {
      for (const decisionId of supersedes) {
        this.#sql.exec(
          "UPDATE decisions SET status = 'superseded', superseded_by = ? WHERE decision_id = ?",
          decision.decisionId, decisionId,
        );
      }
      this.#sql.exec(
        `INSERT INTO decisions (decision_id, summary, rationale, node_ids, edge_ids, status,
           decided_at, decided_by) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
        decision.decisionId, summary, rationale, JSON.stringify(nodeIds), JSON.stringify(edgeIds),
        decision.decidedAt, accountId,
      );
      this.#commit(revision, decision.decidedAt, {
        accountId, source: "user", opsJson: "[]", decisionId: decision.decisionId,
      });
    });
    await this.#publishSummary();
    return decision;
  }

  /** Records an open question. */
  async raiseQuestion(
    accountId: string,
    question: { text: string; nodeIds?: string[] },
  ): Promise<{ questionId: string }> {
    this.#requireEditor(accountId);
    const text = requireText(question.text, "Question", MAX_QUESTION_LENGTH);
    const nodeIds = this.#requireExisting("nodes", question.nodeIds ?? [], "Node");
    const questionId = crypto.randomUUID();
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.#sql.exec(
        `INSERT INTO questions (question_id, text, node_ids, raised_at, raised_by)
         VALUES (?, ?, ?, ?, ?)`,
        questionId, text, JSON.stringify(nodeIds), now, accountId,
      );
      this.#sql.exec("UPDATE meta SET updated_at = ? WHERE id = 1", now);
    });
    await this.#publishSummary();
    return { questionId };
  }

  /** Marks an open question answered. */
  async resolveQuestion(accountId: string, questionId: string, answer: string): Promise<void> {
    this.#requireEditor(accountId);
    const cleanAnswer = requireText(answer, "Answer", MAX_ANSWER_LENGTH);
    const row = this.#sql.exec<{ resolved_at: number | null }>(
      "SELECT resolved_at FROM questions WHERE question_id = ?", questionId,
    ).toArray()[0];
    if (!row) throw new Error(`Question "${questionId}" does not exist.`);
    if (row.resolved_at !== null) throw new Error(`Question "${questionId}" is already resolved.`);
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.#sql.exec(
        "UPDATE questions SET resolved_at = ?, resolved_by = ?, answer = ? WHERE question_id = ?",
        now, accountId, cleanAnswer, questionId,
      );
      this.#sql.exec("UPDATE meta SET updated_at = ? WHERE id = 1", now);
    });
    await this.#publishSummary();
  }

  #initialized(): boolean {
    return this.#sql.exec(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'",
    ).toArray().length > 0 && this.#readMeta() !== undefined;
  }

  #readMeta(): Meta | undefined {
    const row = this.#sql.exec<{
      project_id: string;
      sharing_domain: string;
      name: string;
      created_at: number;
      updated_at: number;
      revision: number;
    }>("SELECT * FROM meta WHERE id = 1").toArray()[0];
    return row && {
      projectId: row.project_id,
      sharingDomain: row.sharing_domain,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
    };
  }

  #requireMeta(): Meta {
    const meta = this.#initialized() ? this.#readMeta() : undefined;
    if (!meta) throw new Error(ACCESS_DENIED);
    return meta;
  }

  #roleOf(accountId: string): ProjectRole | null {
    const row = this.#sql.exec<{ role: string }>(
      "SELECT role FROM members WHERE account_id = ?", accountId,
    ).toArray()[0];
    return row ? (row.role as ProjectRole) : null;
  }

  #requireRole(accountId: string): ProjectRole {
    const role = this.memberRole(accountId);
    if (!role) throw new Error(ACCESS_DENIED);
    return role;
  }

  #requireEditor(accountId: string): ProjectRole {
    const role = this.#requireRole(accountId);
    if (role === "viewer") throw new Error("Viewers cannot edit this project.");
    return role;
  }

  #readGraph(revision: number): ProcessGraph {
    const lanes: ProcessLane[] = this.#sql.exec<{ id: string; label: string }>(
      "SELECT id, label FROM lanes ORDER BY position",
    ).toArray().map((row) => ({ id: row.id, label: row.label }));
    const nodes: ProcessNode[] = this.#sql.exec<{
      id: string; type: string; label: string; lane_id: string; x: number; y: number;
    }>("SELECT id, type, label, lane_id, x, y FROM nodes ORDER BY rowid").toArray().map((row) => ({
      id: row.id,
      type: row.type as ProcessNodeType,
      label: row.label,
      laneId: row.lane_id,
      x: row.x,
      y: row.y,
    }));
    const edges: ProcessEdge[] = this.#sql.exec<{
      id: string; source: string; target: string; label: string | null;
    }>("SELECT id, source, target, label FROM edges ORDER BY rowid").toArray().map((row) => (
      row.label === null
        ? { id: row.id, source: row.source, target: row.target }
        : { id: row.id, source: row.source, target: row.target, label: row.label }
    ));
    return { revision, lanes, nodes, edges };
  }

  #snapshot(role: ProjectRole): ProjectSnapshot {
    const meta = this.#requireMeta();
    const decisions = this.#sql.exec<DecisionRow>(
      "SELECT * FROM decisions ORDER BY decided_at DESC, rowid DESC",
    ).toArray().map(toDecision);
    const openQuestions: OpenQuestion[] = this.#sql.exec<{
      question_id: string; text: string; node_ids: string; raised_at: number;
    }>(
      `SELECT question_id, text, node_ids, raised_at FROM questions
       WHERE resolved_at IS NULL ORDER BY raised_at, rowid`,
    ).toArray().map((row) => ({
      questionId: row.question_id,
      text: row.text,
      nodeIds: JSON.parse(row.node_ids) as string[],
      raisedAt: row.raised_at,
    }));
    return {
      projectId: meta.projectId,
      name: meta.name,
      role,
      graph: this.#readGraph(meta.revision),
      decisions,
      openQuestions,
    };
  }

  #locks(): { nodeIds: Set<string>; edgeIds: Set<string> } {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    for (const row of this.#sql.exec<{ node_ids: string; edge_ids: string }>(
      "SELECT node_ids, edge_ids FROM decisions WHERE status = 'active'",
    )) {
      for (const id of JSON.parse(row.node_ids) as string[]) nodeIds.add(id);
      for (const id of JSON.parse(row.edge_ids) as string[]) edgeIds.add(id);
    }
    return { nodeIds, edgeIds };
  }

  #findConflict(batch: OpBatch, graph: ProcessGraph): string | null {
    const touched = touchedElementIds(batch.ops, graph);
    for (const [table, kind, ids] of [
      ["nodes", "Node", touched.nodeIds],
      ["edges", "Edge", touched.edgeIds],
    ] as const) {
      for (const id of ids) {
        const row = this.#sql.exec<{ modified_revision: number }>(
          `SELECT modified_revision FROM ${table} WHERE id = ?`, id,
        ).toArray()[0];
        if (row && row.modified_revision > batch.baseRevision) {
          return `${kind} "${id}" changed at revision ${row.modified_revision}, after base ` +
            `revision ${batch.baseRevision}.`;
        }
      }
    }
    return null;
  }

  #requireExisting(table: "nodes" | "edges", ids: string[], kind: string): string[] {
    const unique = uniqueIds(ids, `${kind.toLowerCase()} IDs`);
    for (const id of unique) {
      const found = this.#sql.exec(`SELECT 1 FROM ${table} WHERE id = ?`, id).toArray().length > 0;
      if (!found) throw new Error(`${kind} "${id}" does not exist.`);
    }
    return unique;
  }

  #writeGraph(before: ProcessGraph, after: ProcessGraph, revision: number): void {
    if (JSON.stringify(before.lanes) !== JSON.stringify(after.lanes)) {
      this.#sql.exec("DELETE FROM lanes");
      after.lanes.forEach((lane, position) => {
        this.#sql.exec(
          "INSERT INTO lanes (id, label, position) VALUES (?, ?, ?)", lane.id, lane.label, position,
        );
      });
    }
    const oldNodes = new Map(before.nodes.map((node) => [node.id, node]));
    for (const node of after.nodes) {
      const old = oldNodes.get(node.id);
      oldNodes.delete(node.id);
      if (old && old.type === node.type && old.label === node.label &&
          old.laneId === node.laneId && old.x === node.x && old.y === node.y) continue;
      this.#sql.exec(
        `INSERT INTO nodes (id, type, label, lane_id, x, y, modified_revision)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET type = excluded.type, label = excluded.label,
           lane_id = excluded.lane_id, x = excluded.x, y = excluded.y,
           modified_revision = excluded.modified_revision`,
        node.id, node.type, node.label, node.laneId, node.x, node.y, revision,
      );
    }
    for (const id of oldNodes.keys()) this.#sql.exec("DELETE FROM nodes WHERE id = ?", id);

    const oldEdges = new Map(before.edges.map((edge) => [edge.id, edge]));
    for (const edge of after.edges) {
      const old = oldEdges.get(edge.id);
      oldEdges.delete(edge.id);
      if (old && old.source === edge.source && old.target === edge.target &&
          old.label === edge.label) continue;
      this.#sql.exec(
        `INSERT INTO edges (id, source, target, label, modified_revision) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET source = excluded.source, target = excluded.target,
           label = excluded.label, modified_revision = excluded.modified_revision`,
        edge.id, edge.source, edge.target, edge.label ?? null, revision,
      );
    }
    for (const id of oldEdges.keys()) this.#sql.exec("DELETE FROM edges WHERE id = ?", id);
  }

  #commit(
    revision: number,
    at: number,
    entry: {
      accountId: string;
      source: ChangeSource;
      opsJson: string;
      clientOpId?: string;
      decisionId?: string;
    },
  ): void {
    this.#sql.exec("UPDATE meta SET revision = ?, updated_at = ? WHERE id = 1", revision, at);
    this.#sql.exec(
      `INSERT INTO ops_log (revision, client_op_id, actor_account_id, source, ops_json,
         decision_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      revision, entry.clientOpId ?? null, entry.accountId, entry.source, entry.opsJson,
      entry.decisionId ?? null, at,
    );
    this.#sql.exec("DELETE FROM ops_log WHERE revision <= ?", revision - OP_LOG_LIMIT);
  }

  // Best-effort: the index is a listing cache; membership authority stays here.
  async #publishSummary(accountIds?: string[]): Promise<void> {
    const meta = this.#requireMeta();
    const summary: ProjectSummary = {
      projectId: meta.projectId, name: meta.name, updatedAt: meta.updatedAt,
    };
    const targets = accountIds ?? this.#sql.exec<{ account_id: string }>(
      "SELECT account_id FROM members",
    ).toArray().map((row) => row.account_id);
    const results = await Promise.allSettled(targets.map((accountId) =>
      this.ctx.exports.AccountProjectsDO
        .getByName(domainName(meta.sharingDomain, accountId))
        .upsert(summary)
    ));
    for (const result of results) {
      if (result.status === "rejected") {
        logger.warn("failed to update project index", {
          event: "project.index.update.failed", projectId: meta.projectId, error: result.reason,
        });
      }
    }
  }
}

function toDecision(row: DecisionRow): Decision {
  const decision: Decision = {
    decisionId: row.decision_id,
    summary: row.summary,
    rationale: row.rationale,
    nodeIds: JSON.parse(row.node_ids) as string[],
    edgeIds: JSON.parse(row.edge_ids) as string[],
    status: row.status === "superseded" ? "superseded" : "active",
    decidedAt: row.decided_at,
  };
  if (row.superseded_by !== null) decision.supersededBy = row.superseded_by;
  return decision;
}

function requireText(value: string, what: string, max: number, allowEmpty = false): string {
  const text = value.trim();
  if (!allowEmpty && text === "") throw new Error(`${what} must not be empty.`);
  if (text.length > max) throw new Error(`${what} must be at most ${max} characters.`);
  return text;
}

function uniqueIds(ids: string[], what: string): string[] {
  const unique = [...new Set(ids)];
  if (unique.length > MAX_REFERENCED_IDS) {
    throw new Error(`At most ${MAX_REFERENCED_IDS} ${what} may be referenced.`);
  }
  return unique;
}
