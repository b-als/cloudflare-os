import { DurableObject, RpcTarget, type RpcStub } from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import { applyGraphOps, GraphOpError, layoutGraph, touchedElementIds } from "./graph-ops.js";
import type {
  ChangeSet,
  Decision,
  GraphOp,
  OpenQuestion,
  ProcessEdge,
  ProcessGraph,
  ProcessLane,
  ProcessNode,
  ProcessNodeType,
  ProjectSummary,
  Stakeholder,
  StakeholderInput,
  StakeholderStance,
  StepDuration,
} from "./types.js";
import type {
  ApplyResult,
  ChangeSource,
  OpBatch,
  ProjectChange,
  ProjectHandle,
  ProjectSnapshot,
  ProjectSubscriber,
} from "./ui-types.js";

/** Input to `recordDecision`, identical to the UI-facing handle's argument. */
export type DecisionInput = Parameters<ProjectHandle["recordDecision"]>[0];

/** An accepted agent change set; `decisionId` was assigned when it was proposed. */
export type AgentChangeInput = ChangeSet & { decisionId: string };

/** What a `process://new` binding needs to create its project on first claim. */
export type NewProjectInput = {
  projectId: string;
  name: string;
  creatorAccountId: string;
  sharingDomain: string;
};

type SubscriberStub = RpcStub<ProjectSubscriber & RpcTarget>;

export const OP_LOG_LIMIT = 500;
export const MAX_PROJECT_NAME_LENGTH = 120;
export const MAX_SUMMARY_LENGTH = 200;
export const MAX_RATIONALE_LENGTH = 4000;
export const MAX_QUESTION_LENGTH = 2000;
export const MAX_ANSWER_LENGTH = 4000;
export const MAX_STAKEHOLDER_NAME_LENGTH = 120;
export const MAX_STAKEHOLDER_ROLE_LENGTH = 120;
export const MAX_USER_ID_LENGTH = 128;
export const MAX_CLIENT_OP_ID_LENGTH = 128;
export const MAX_REFERENCED_IDS = 500;

const STANCES = new Set<StakeholderStance>(["champion", "supporter", "neutral", "sceptic"]);

const NOT_FOUND = "Project not found or you do not have access.";

type Meta = {
  projectId: string;
  sharingDomain: string;
  name: string;
  creatorAccountId: string;
  claimedBy: string | null;
  createdAt: number;
  updatedAt: number;
  revision: number;
  interviewTargetStakeholderId: string | null;
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
  locked: number;
};

const SCHEMA = `
CREATE TABLE meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  project_id TEXT NOT NULL,
  sharing_domain TEXT NOT NULL,
  name TEXT NOT NULL,
  creator_account_id TEXT NOT NULL,
  claimed_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  interview_target_stakeholder_id TEXT
);
CREATE TABLE lanes (id TEXT PRIMARY KEY, label TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  lane_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  description TEXT,
  owner TEXT,
  system TEXT,
  inputs TEXT,
  outputs TEXT,
  duration_amount REAL,
  duration_unit TEXT,
  pain_points TEXT,
  modified_revision INTEGER NOT NULL
);
CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  label TEXT,
  modified_revision INTEGER NOT NULL
);
CREATE TABLE decisions (
  decision_id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  rationale TEXT NOT NULL,
  node_ids TEXT NOT NULL,
  edge_ids TEXT NOT NULL,
  status TEXT NOT NULL,
  superseded_by TEXT,
  decided_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE questions (
  question_id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  node_ids TEXT NOT NULL,
  raised_at INTEGER NOT NULL,
  raised_source TEXT NOT NULL,
  resolved_at INTEGER,
  resolved_source TEXT,
  answer TEXT,
  assignee_stakeholder_id TEXT,
  assignee_user_id TEXT
);
CREATE TABLE stakeholders (
  stakeholder_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  stance TEXT NOT NULL,
  user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE ops_log (
  revision INTEGER PRIMARY KEY,
  client_op_id TEXT,
  source TEXT NOT NULL,
  change_json TEXT NOT NULL,
  at INTEGER NOT NULL
);
`;

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
 * One process project: the sole writer of its graph, decisions, and questions. It holds no
 * per-user authority; callers are this worker's code, gated by the claiming workspace binding.
 */
@validateRpc()
export class ProcessProjectDO extends DurableObject<Cloudflare.Env> {
  readonly #sql: SqlStorage;
  readonly #subscribers = new Set<SubscriberStub>();

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.#sql = ctx.storage.sql;
    // Projects created before decisions gained `locked` treated every decision as locking.
    if (this.#initialized() && !this.#sql.exec("PRAGMA table_info(decisions)").toArray()
        .some((column) => column.name === "locked")) {
      this.#sql.exec("ALTER TABLE decisions ADD COLUMN locked INTEGER NOT NULL DEFAULT 1");
    }
    // Projects created before steps gained detail fields are missing these columns.
    if (this.#initialized()) {
      const nodeColumns = new Set(
        this.#sql.exec("PRAGMA table_info(nodes)").toArray().map((column) => column.name as string),
      );
      for (const [name, sqlType] of [
        ["description", "TEXT"], ["owner", "TEXT"], ["system", "TEXT"], ["inputs", "TEXT"],
        ["outputs", "TEXT"], ["duration_amount", "REAL"], ["duration_unit", "TEXT"], ["pain_points", "TEXT"],
      ] as const) {
        if (!nodeColumns.has(name)) this.#sql.exec(`ALTER TABLE nodes ADD COLUMN ${name} ${sqlType}`);
      }
      const metaColumns = new Set(
        this.#sql.exec("PRAGMA table_info(meta)").toArray().map((column) => column.name as string),
      );
      if (!metaColumns.has("interview_target_stakeholder_id")) {
        this.#sql.exec("ALTER TABLE meta ADD COLUMN interview_target_stakeholder_id TEXT");
      }
      const questionColumns = new Set(
        this.#sql.exec("PRAGMA table_info(questions)").toArray().map((column) => column.name as string),
      );
      if (!questionColumns.has("assignee_stakeholder_id")) {
        this.#sql.exec("ALTER TABLE questions ADD COLUMN assignee_stakeholder_id TEXT");
      }
      if (!questionColumns.has("assignee_user_id")) {
        this.#sql.exec("ALTER TABLE questions ADD COLUMN assignee_user_id TEXT");
      }
      this.#sql.exec(
        `CREATE TABLE IF NOT EXISTS stakeholders (
          stakeholder_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          stance TEXT NOT NULL,
          user_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
      );
    }
  }

  /** Creates the project. Throws if already initialized. */
  init(
    projectId: string,
    name: string,
    creatorAccountId: string,
    sharingDomain: string,
  ): ProjectSummary {
    if (this.#initialized()) throw new Error("Project already exists.");
    const cleanName = requireText(name, "Project name", MAX_PROJECT_NAME_LENGTH);
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.#sql.exec(SCHEMA);
      this.#sql.exec(
        `INSERT INTO meta (id, project_id, sharing_domain, name, creator_account_id, created_at,
           updated_at, revision, interview_target_stakeholder_id) VALUES (1, ?, ?, ?, ?, ?, ?, 0, NULL)`,
        projectId, sharingDomain, cleanName, creatorAccountId, now, now,
      );
    });
    return { projectId, name: cleanName, updatedAt: now };
  }

  /** The creating account's ID, or null if the project does not exist. */
  creatorAccountId(): string | null {
    return this.#initialized() ? this.#requireMeta().creatorAccountId : null;
  }

  /**
   * Links the project to `workspaceId`, creating it first from `create` if it does not exist yet.
   * Idempotent for the claiming workspace; throws for any other.
   */
  claim(workspaceId: string, create?: NewProjectInput): void {
    if (!this.#initialized()) {
      if (!create) throw new Error(NOT_FOUND);
      this.init(create.projectId, create.name, create.creatorAccountId, create.sharingDomain);
    }
    const { claimedBy } = this.#requireMeta();
    if (claimedBy === workspaceId) return;
    if (claimedBy !== null) throw new Error("This project is already linked to another workspace.");
    this.#sql.exec("UPDATE meta SET claimed_by = ? WHERE id = 1", workspaceId);
  }

  /** Full project state. */
  snapshot(): ProjectSnapshot {
    const meta = this.#requireMeta();
    const decisions = this.#sql.exec<DecisionRow>(
      "SELECT * FROM decisions ORDER BY decided_at DESC, rowid DESC",
    ).toArray().map(toDecision);
    const openQuestions: OpenQuestion[] = this.#sql.exec<{
      question_id: string; text: string; node_ids: string; raised_at: number;
      assignee_stakeholder_id: string | null; assignee_user_id: string | null;
    }>(
      `SELECT question_id, text, node_ids, raised_at, assignee_stakeholder_id, assignee_user_id
       FROM questions WHERE resolved_at IS NULL ORDER BY raised_at, rowid`,
    ).toArray().map(toOpenQuestion);
    return {
      projectId: meta.projectId,
      name: meta.name,
      graph: this.#readGraph(meta.revision),
      decisions,
      openQuestions,
      stakeholders: this.#readStakeholders(),
      interviewTargetStakeholderId: meta.interviewTargetStakeholderId,
    };
  }

  /**
   * Applies a batch with per-element optimistic concurrency. Only `moveNode` may touch elements
   * locked by an active decision; unlocking takes a superseding `recordDecision`.
   */
  applyOps(batch: OpBatch, source: ChangeSource): ApplyResult {
    if (typeof batch.clientOpId !== "string" || batch.clientOpId.length === 0 ||
        batch.clientOpId.length > MAX_CLIENT_OP_ID_LENGTH) {
      throw new TypeError(`clientOpId must be 1-${MAX_CLIENT_OP_ID_LENGTH} characters.`);
    }
    const meta = this.#requireMeta();
    const reject = (reason: string): ApplyResult => ({ ok: false, reason, snapshot: this.snapshot() });
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
      });
    } catch (error) {
      if (error instanceof GraphOpError) return reject(error.message);
      throw error;
    }
    const conflict = this.#findConflict(batch, graph);
    if (conflict) return reject(conflict);

    const change: ProjectChange = {
      revision: meta.revision + 1, source, clientOpId: batch.clientOpId, ops: batch.ops,
    };
    this.ctx.storage.transactionSync(() => {
      this.#writeGraph(graph, next, change.revision);
      this.#commit(change, Date.now());
    });
    this.#broadcast(change);
    return { ok: true, revision: change.revision };
  }

  /** Records a decision locking the given elements, superseding the listed active decisions. */
  recordDecision(input: DecisionInput, source: ChangeSource): Decision {
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
      locked: true,
      status: "active",
      decidedAt: Date.now(),
    };
    const change: ProjectChange = { revision: meta.revision + 1, source, ops: [], decision };
    if (supersedes.length > 0) change.supersededDecisionIds = supersedes;
    this.ctx.storage.transactionSync(() => {
      for (const decisionId of supersedes) {
        this.#sql.exec(
          "UPDATE decisions SET status = 'superseded', superseded_by = ? WHERE decision_id = ?",
          decision.decisionId, decisionId,
        );
      }
      this.#sql.exec(
        `INSERT INTO decisions (decision_id, summary, rationale, node_ids, edge_ids, status,
           decided_at, source) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
        decision.decisionId, summary, rationale, JSON.stringify(nodeIds), JSON.stringify(edgeIds),
        decision.decidedAt, source,
      );
      this.#commit(change, decision.decidedAt);
    });
    this.#broadcast(change);
    return decision;
  }

  /**
   * Applies an accepted agent change set and records it as an unlocked decision. Throws if the ops
   * no longer apply, e.g. because stakeholders changed the graph since the agent proposed them.
   */
  applyAgentChange(input: AgentChangeInput): Decision {
    const meta = this.#requireMeta();
    const summary = requireText(input.summary, "Summary", MAX_SUMMARY_LENGTH);
    const rationale = requireText(input.rationale, "Rationale", MAX_RATIONALE_LENGTH, true);
    const supersedes = this.#requireActiveDecisions(input.supersedes ?? []);
    const graph = this.#readGraph(meta.revision);
    const locks = this.#locks(new Set(supersedes));
    let next: ProcessGraph;
    try {
      next = applyGraphOps(graph, input.ops, {
        lockedNodeIds: locks.nodeIds,
        lockedEdgeIds: locks.edgeIds,
      });
    } catch (error) {
      if (error instanceof GraphOpError) {
        throw new Error(`This change no longer applies to the current map: ${error.message}`, { cause: error });
      }
      throw error;
    }
    const touched = touchedElementIds(input.ops, graph);
    const nodeIds = new Set(next.nodes.map((node) => node.id));
    const edgeIds = new Set(next.edges.map((edge) => edge.id));
    const decision: Decision = {
      decisionId: input.decisionId,
      summary,
      rationale,
      nodeIds: touched.nodeIds.filter((id) => nodeIds.has(id)),
      edgeIds: touched.edgeIds.filter((id) => edgeIds.has(id)),
      locked: false,
      status: "active",
      decidedAt: Date.now(),
    };
    const change: ProjectChange = {
      revision: meta.revision + 1, source: "agent", ops: input.ops, decision,
    };
    if (supersedes.length > 0) change.supersededDecisionIds = supersedes;
    this.ctx.storage.transactionSync(() => {
      this.#writeGraph(graph, next, change.revision);
      for (const decisionId of supersedes) {
        this.#sql.exec(
          "UPDATE decisions SET status = 'superseded', superseded_by = ? WHERE decision_id = ?",
          decision.decisionId, decisionId,
        );
      }
      this.#sql.exec(
        `INSERT INTO decisions (decision_id, summary, rationale, node_ids, edge_ids, status,
           decided_at, source, locked) VALUES (?, ?, ?, ?, ?, 'active', ?, 'agent', 0)`,
        decision.decisionId, summary, rationale, JSON.stringify(decision.nodeIds),
        JSON.stringify(decision.edgeIds), decision.decidedAt,
      );
      this.#commit(change, decision.decidedAt);
    });
    this.#broadcast(change);
    return decision;
  }

  /** Records an open question; agent questions keep the ID assigned when they were proposed. */
  raiseQuestion(
    question: {
      text: string;
      nodeIds?: string[];
      assigneeStakeholderId?: string;
      assigneeUserId?: string;
    },
    source: ChangeSource,
    questionId: string = crypto.randomUUID(),
  ): { questionId: string } {
    const meta = this.#requireMeta();
    const assigneeStakeholderId = this.#optionalStakeholderId(question.assigneeStakeholderId);
    const assigneeUserId = optionalUserId(question.assigneeUserId);
    const raised: OpenQuestion = {
      questionId,
      text: requireText(question.text, "Question", MAX_QUESTION_LENGTH),
      nodeIds: this.#requireExisting("nodes", question.nodeIds ?? [], "Node"),
      raisedAt: Date.now(),
    };
    if (assigneeStakeholderId) raised.assigneeStakeholderId = assigneeStakeholderId;
    if (assigneeUserId) raised.assigneeUserId = assigneeUserId;
    const change: ProjectChange = {
      revision: meta.revision + 1, source, ops: [], questionRaised: raised,
    };
    this.ctx.storage.transactionSync(() => {
      this.#sql.exec(
        `INSERT INTO questions (question_id, text, node_ids, raised_at, raised_source,
           assignee_stakeholder_id, assignee_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        raised.questionId, raised.text, JSON.stringify(raised.nodeIds), raised.raisedAt, source,
        assigneeStakeholderId, assigneeUserId,
      );
      this.#commit(change, raised.raisedAt);
    });
    this.#broadcast(change);
    return { questionId: raised.questionId };
  }

  /** Creates or updates a stakeholder register entry. */
  upsertStakeholder(
    input: StakeholderInput,
    source: ChangeSource,
    stakeholderId: string = input.stakeholderId ?? crypto.randomUUID(),
  ): Stakeholder {
    const meta = this.#requireMeta();
    const name = requireText(input.name, "Stakeholder name", MAX_STAKEHOLDER_NAME_LENGTH);
    const role = requireText(input.role, "Stakeholder role", MAX_STAKEHOLDER_ROLE_LENGTH);
    const existing = this.#sql.exec<{
      stakeholder_id: string; stance: string; user_id: string | null; created_at: number;
    }>(
      "SELECT stakeholder_id, stance, user_id, created_at FROM stakeholders WHERE stakeholder_id = ?",
      stakeholderId,
    ).toArray()[0];
    if (input.stakeholderId !== undefined && !existing) {
      throw new Error(`Stakeholder "${stakeholderId}" does not exist.`);
    }
    let userId: string | null;
    if (input.userId === undefined) {
      userId = existing?.user_id ?? null;
    } else if (input.userId === null) {
      userId = null;
    } else {
      userId = optionalUserId(input.userId);
    }
    const resolvedStance = input.stance !== undefined
      ? requireStance(input.stance)
      : (existing ? requireStance(existing.stance) : "neutral");
    const now = Date.now();
    const stakeholder: Stakeholder = {
      stakeholderId,
      name,
      role,
      stance: resolvedStance,
    };
    if (userId) stakeholder.userId = userId;
    const change: ProjectChange = {
      revision: meta.revision + 1, source, ops: [], stakeholderUpserted: stakeholder,
    };
    this.ctx.storage.transactionSync(() => {
      this.#sql.exec(
        `INSERT INTO stakeholders (stakeholder_id, name, role, stance, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (stakeholder_id) DO UPDATE SET name = excluded.name, role = excluded.role,
           stance = excluded.stance, user_id = excluded.user_id, updated_at = excluded.updated_at`,
        stakeholderId, name, role, resolvedStance, userId, existing?.created_at ?? now, now,
      );
      this.#commit(change, now);
    });
    this.#broadcast(change);
    return stakeholder;
  }

  /** Removes a stakeholder; clears their interview target and question assignees. */
  removeStakeholder(stakeholderId: string, source: ChangeSource): void {
    const meta = this.#requireMeta();
    const found = this.#sql.exec(
      "SELECT 1 FROM stakeholders WHERE stakeholder_id = ?", stakeholderId,
    ).toArray().length > 0;
    if (!found) throw new Error(`Stakeholder "${stakeholderId}" does not exist.`);
    const change: ProjectChange = {
      revision: meta.revision + 1, source, ops: [], stakeholderRemoved: { stakeholderId },
    };
    if (meta.interviewTargetStakeholderId === stakeholderId) {
      change.interviewTargetChanged = { stakeholderId: null };
    }
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.#sql.exec(
        `UPDATE questions SET assignee_stakeholder_id = NULL
         WHERE assignee_stakeholder_id = ? AND resolved_at IS NULL`,
        stakeholderId,
      );
      if (meta.interviewTargetStakeholderId === stakeholderId) {
        this.#sql.exec("UPDATE meta SET interview_target_stakeholder_id = NULL WHERE id = 1");
      }
      this.#sql.exec("DELETE FROM stakeholders WHERE stakeholder_id = ?", stakeholderId);
      this.#commit(change, now);
    });
    this.#broadcast(change);
  }

  /** Sets who the agent should interview next, or clears the target. */
  setInterviewTarget(stakeholderId: string | null, source: ChangeSource): void {
    const meta = this.#requireMeta();
    const next = stakeholderId === null ? null : this.#optionalStakeholderId(stakeholderId);
    if (meta.interviewTargetStakeholderId === next) return;
    const change: ProjectChange = {
      revision: meta.revision + 1,
      source,
      ops: [],
      interviewTargetChanged: { stakeholderId: next },
    };
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.#sql.exec("UPDATE meta SET interview_target_stakeholder_id = ? WHERE id = 1", next);
      this.#commit(change, now);
    });
    this.#broadcast(change);
  }

  /** Marks an open question answered. */
  resolveQuestion(questionId: string, answer: string, source: ChangeSource): void {
    const meta = this.#requireMeta();
    const cleanAnswer = requireText(answer, "Answer", MAX_ANSWER_LENGTH);
    const row = this.#sql.exec<{ resolved_at: number | null }>(
      "SELECT resolved_at FROM questions WHERE question_id = ?", questionId,
    ).toArray()[0];
    if (!row) throw new Error(`Question "${questionId}" does not exist.`);
    if (row.resolved_at !== null) throw new Error(`Question "${questionId}" is already resolved.`);
    const change: ProjectChange = {
      revision: meta.revision + 1,
      source,
      ops: [],
      questionResolved: { questionId, answer: cleanAnswer },
    };
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.#sql.exec(
        `UPDATE questions SET resolved_at = ?, resolved_source = ?, answer = ?
         WHERE question_id = ?`,
        now, source, cleanAnswer, questionId,
      );
      this.#commit(change, now);
    });
    this.#broadcast(change);
  }

  /**
   * Recomputes every step's position from the flow, as a single committed change. A no-op if
   * positions already match.
   */
  layout(): ApplyResult {
    const meta = this.#requireMeta();
    const graph = this.#readGraph(meta.revision);
    const laidOut = layoutGraph(graph);
    const before = new Map(graph.nodes.map((node) => [node.id, node]));
    const ops: GraphOp[] = [];
    for (const node of laidOut.nodes) {
      const prior = before.get(node.id);
      if (prior && (prior.x !== node.x || prior.y !== node.y)) {
        ops.push({ op: "moveNode", id: node.id, x: node.x, y: node.y });
      }
    }
    if (ops.length === 0) return { ok: true, revision: meta.revision };
    const locks = this.#locks();
    let next: ProcessGraph;
    try {
      next = applyGraphOps(graph, ops, { lockedNodeIds: locks.nodeIds, lockedEdgeIds: locks.edgeIds });
    } catch (error) {
      if (error instanceof GraphOpError) return { ok: false, reason: error.message, snapshot: this.snapshot() };
      throw error;
    }
    const change: ProjectChange = { revision: meta.revision + 1, source: "user", ops };
    this.ctx.storage.transactionSync(() => {
      this.#writeGraph(graph, next, change.revision);
      this.#commit(change, Date.now());
    });
    this.#broadcast(change);
    return { ok: true, revision: change.revision };
  }

  /**
   * Streams every commit after `fromRevision` to `subscriber`: replays the op log, or sends one
   * `reset` when the log no longer reaches back that far. Dispose the result to unsubscribe.
   */
  @skipRpcValidation()
  subscribe(subscriber: SubscriberStub, fromRevision: number): Subscription {
    const meta = this.#requireMeta();
    const own = subscriber.dup();
    this.#subscribers.add(own);
    const oldest = this.#sql.exec<{ lo: number | null }>(
      "SELECT MIN(revision) AS lo FROM ops_log",
    ).one().lo;
    const replayable = Number.isInteger(fromRevision) && fromRevision >= 0 &&
      fromRevision <= meta.revision &&
      (fromRevision === meta.revision || (oldest !== null && oldest <= fromRevision + 1));
    if (!replayable) {
      this.#deliver(own, own.reset(this.snapshot()));
    } else {
      for (const row of this.#sql.exec<{ change_json: string }>(
        "SELECT change_json FROM ops_log WHERE revision > ? ORDER BY revision", fromRevision,
      )) {
        this.#deliver(own, own.changed(JSON.parse(row.change_json) as ProjectChange));
      }
    }
    return new Subscription(() => this.#drop(own));
  }

  #broadcast(change: ProjectChange): void {
    for (const subscriber of this.#subscribers) {
      this.#deliver(subscriber, subscriber.changed(change));
    }
  }

  #deliver(subscriber: SubscriberStub, call: Promise<unknown>): void {
    call.catch(() => this.#drop(subscriber));
  }

  #drop(subscriber: SubscriberStub): void {
    if (this.#subscribers.delete(subscriber)) subscriber[Symbol.dispose]();
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
      creator_account_id: string;
      claimed_by: string | null;
      created_at: number;
      updated_at: number;
      revision: number;
      interview_target_stakeholder_id: string | null;
    }>("SELECT * FROM meta WHERE id = 1").toArray()[0];
    return row && {
      projectId: row.project_id,
      sharingDomain: row.sharing_domain,
      name: row.name,
      creatorAccountId: row.creator_account_id,
      claimedBy: row.claimed_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
      interviewTargetStakeholderId: row.interview_target_stakeholder_id ?? null,
    };
  }

  #readStakeholders(): Stakeholder[] {
    return this.#sql.exec<{
      stakeholder_id: string; name: string; role: string; stance: string; user_id: string | null;
    }>(
      "SELECT stakeholder_id, name, role, stance, user_id FROM stakeholders ORDER BY created_at, rowid",
    ).toArray().map((row) => {
      const stakeholder: Stakeholder = {
        stakeholderId: row.stakeholder_id,
        name: row.name,
        role: row.role,
        stance: requireStance(row.stance),
      };
      if (row.user_id) stakeholder.userId = row.user_id;
      return stakeholder;
    });
  }

  #optionalStakeholderId(id: string | undefined): string | null {
    if (id === undefined || id === "") return null;
    const found = this.#sql.exec(
      "SELECT 1 FROM stakeholders WHERE stakeholder_id = ?", id,
    ).toArray().length > 0;
    if (!found) throw new Error(`Stakeholder "${id}" does not exist.`);
    return id;
  }

  #requireMeta(): Meta {
    const meta = this.#initialized() ? this.#readMeta() : undefined;
    if (!meta) throw new Error(NOT_FOUND);
    return meta;
  }

  #readGraph(revision: number): ProcessGraph {
    const lanes: ProcessLane[] = this.#sql.exec<{ id: string; label: string }>(
      "SELECT id, label FROM lanes ORDER BY position",
    ).toArray().map((row) => ({ id: row.id, label: row.label }));
    const nodes: ProcessNode[] = this.#sql.exec<{
      id: string; type: string; label: string; lane_id: string; x: number; y: number;
      description: string | null; owner: string | null; system: string | null;
      inputs: string | null; outputs: string | null;
      duration_amount: number | null; duration_unit: string | null; pain_points: string | null;
    }>(
      `SELECT id, type, label, lane_id, x, y, description, owner, system, inputs, outputs,
              duration_amount, duration_unit, pain_points
       FROM nodes ORDER BY rowid`,
    ).toArray().map((row) => {
      const node: ProcessNode = {
        id: row.id,
        type: row.type as ProcessNodeType,
        label: row.label,
        laneId: row.lane_id,
        x: row.x,
        y: row.y,
      };
      if (row.description !== null) node.description = row.description;
      if (row.owner !== null) node.owner = row.owner;
      if (row.system !== null) node.system = row.system;
      if (row.inputs !== null) node.inputs = JSON.parse(row.inputs) as string[];
      if (row.outputs !== null) node.outputs = JSON.parse(row.outputs) as string[];
      if (row.duration_amount !== null && row.duration_unit !== null) {
        node.duration = { amount: row.duration_amount, unit: row.duration_unit as StepDuration["unit"] };
      }
      if (row.pain_points !== null) node.painPoints = row.pain_points;
      return node;
    });
    const edges: ProcessEdge[] = this.#sql.exec<{
      id: string; source: string; target: string; label: string | null;
    }>("SELECT id, source, target, label FROM edges ORDER BY rowid").toArray().map((row) => (
      row.label === null
        ? { id: row.id, source: row.source, target: row.target }
        : { id: row.id, source: row.source, target: row.target, label: row.label }
    ));
    return { revision, lanes, nodes, edges };
  }

  #locks(except: ReadonlySet<string> = new Set()): { nodeIds: Set<string>; edgeIds: Set<string> } {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    for (const row of this.#sql.exec<{ decision_id: string; node_ids: string; edge_ids: string }>(
      "SELECT decision_id, node_ids, edge_ids FROM decisions WHERE status = 'active' AND locked = 1",
    )) {
      if (except.has(row.decision_id)) continue;
      for (const id of JSON.parse(row.node_ids) as string[]) nodeIds.add(id);
      for (const id of JSON.parse(row.edge_ids) as string[]) edgeIds.add(id);
    }
    return { nodeIds, edgeIds };
  }

  #requireActiveDecisions(ids: string[]): string[] {
    const unique = uniqueIds(ids, "supersedes");
    for (const decisionId of unique) {
      const row = this.#sql.exec<{ status: string }>(
        "SELECT status FROM decisions WHERE decision_id = ?", decisionId,
      ).toArray()[0];
      if (row?.status !== "active") {
        throw new Error(`Decision "${decisionId}" is not an active decision.`);
      }
    }
    return unique;
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
      if (old && nodesEqual(old, node)) continue;
      this.#sql.exec(
        `INSERT INTO nodes (id, type, label, lane_id, x, y, description, owner, system, inputs,
           outputs, duration_amount, duration_unit, pain_points, modified_revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET type = excluded.type, label = excluded.label,
           lane_id = excluded.lane_id, x = excluded.x, y = excluded.y,
           description = excluded.description, owner = excluded.owner, system = excluded.system,
           inputs = excluded.inputs, outputs = excluded.outputs,
           duration_amount = excluded.duration_amount, duration_unit = excluded.duration_unit,
           pain_points = excluded.pain_points, modified_revision = excluded.modified_revision`,
        node.id, node.type, node.label, node.laneId, node.x, node.y,
        node.description ?? null, node.owner ?? null, node.system ?? null,
        node.inputs ? JSON.stringify(node.inputs) : null,
        node.outputs ? JSON.stringify(node.outputs) : null,
        node.duration?.amount ?? null, node.duration?.unit ?? null,
        node.painPoints ?? null, revision,
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

  #commit(change: ProjectChange, at: number): void {
    this.#sql.exec(
      "UPDATE meta SET revision = ?, updated_at = ? WHERE id = 1", change.revision, at,
    );
    this.#sql.exec(
      `INSERT INTO ops_log (revision, client_op_id, source, change_json, at)
       VALUES (?, ?, ?, ?, ?)`,
      change.revision, change.clientOpId ?? null, change.source, JSON.stringify(change), at,
    );
    this.#sql.exec("DELETE FROM ops_log WHERE revision <= ?", change.revision - OP_LOG_LIMIT);
  }
}

function toDecision(row: DecisionRow): Decision {
  const decision: Decision = {
    decisionId: row.decision_id,
    summary: row.summary,
    rationale: row.rationale,
    nodeIds: JSON.parse(row.node_ids) as string[],
    edgeIds: JSON.parse(row.edge_ids) as string[],
    locked: row.locked !== 0,
    status: row.status === "superseded" ? "superseded" : "active",
    decidedAt: row.decided_at,
  };
  if (row.superseded_by !== null) decision.supersededBy = row.superseded_by;
  return decision;
}

function toOpenQuestion(row: {
  question_id: string;
  text: string;
  node_ids: string;
  raised_at: number;
  assignee_stakeholder_id: string | null;
  assignee_user_id: string | null;
}): OpenQuestion {
  const question: OpenQuestion = {
    questionId: row.question_id,
    text: row.text,
    nodeIds: JSON.parse(row.node_ids) as string[],
    raisedAt: row.raised_at,
  };
  if (row.assignee_stakeholder_id) question.assigneeStakeholderId = row.assignee_stakeholder_id;
  if (row.assignee_user_id) question.assigneeUserId = row.assignee_user_id;
  return question;
}

function requireStance(value: unknown): StakeholderStance {
  if (typeof value === "string" && STANCES.has(value as StakeholderStance)) {
    return value as StakeholderStance;
  }
  throw new Error(`Stance must be one of: ${[...STANCES].join(", ")}.`);
}

function optionalUserId(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_USER_ID_LENGTH) {
    throw new Error(`User id must be 1-${MAX_USER_ID_LENGTH} characters.`);
  }
  return text;
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

function nodesEqual(a: ProcessNode, b: ProcessNode): boolean {
  return a.type === b.type && a.label === b.label && a.laneId === b.laneId &&
    a.x === b.x && a.y === b.y && a.description === b.description && a.owner === b.owner &&
    a.system === b.system && a.painPoints === b.painPoints &&
    JSON.stringify(a.inputs) === JSON.stringify(b.inputs) &&
    JSON.stringify(a.outputs) === JSON.stringify(b.outputs) &&
    JSON.stringify(a.duration) === JSON.stringify(b.duration);
}
