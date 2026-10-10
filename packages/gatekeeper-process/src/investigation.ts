import { type RpcTarget } from "cloudflare:workers";
import type { HookInitiator } from "@gadgets/workshop-shared/gatekeeper";
import { createLogger } from "@gadgets/observability/logger";
import { findQuestion } from "./knowledge.js";
import type {
  InterviewContext, InvestigationEvent, InvestigationHook, InvestigationStatus, ProjectKnowledge,
  StakeholderContribution,
} from "./types.js";

/** The platform hook generic requires the RPC marker, unlike the self-contained agent contract. */
export type InvestigationHookTarget = InvestigationHook & RpcTarget;
type Initiator = Fetcher<HookInitiator<InvestigationHookTarget>>;
type Watch = { id: string; initiator: Initiator };
type EventRow = { id: string; payload: string; attempts: number; due_at: number; deadline: number | null };

const logger = createLogger<{ vendorId: string; eventId: string; attempt: number }>({
  component: "gatekeeper.process.investigation", vendorId: "process",
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS project_knowledge (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL, records TEXT NOT NULL);
INSERT OR IGNORE INTO project_knowledge VALUES (1, 0, '[]');
CREATE TABLE IF NOT EXISTS interviews (question_id TEXT PRIMARY KEY, token TEXT NOT NULL, baseline_revision INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS contributions (id TEXT PRIMARY KEY, interview_token TEXT NOT NULL, request_id TEXT NOT NULL, payload TEXT NOT NULL,
  UNIQUE(interview_token, request_id));
CREATE TABLE IF NOT EXISTS investigation_events (id TEXT PRIMARY KEY, payload TEXT NOT NULL, due_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, deadline INTEGER, status TEXT NOT NULL DEFAULT 'pending');
`;

/** Project-owned durable investigation records and an at-least-once, bounded hook outbox. */
export class Investigation {
  readonly #sql: SqlStorage;

  constructor(private readonly storage: DurableObjectStorage) {
    this.#sql = storage.sql;
    this.#sql.exec(SCHEMA);
  }

  knowledge(): ProjectKnowledge {
    const row = this.#sql.exec<{ revision: number; records: string }>("SELECT * FROM project_knowledge WHERE id = 1").one();
    return { revision: row.revision, records: JSON.parse(row.records) as ProjectKnowledge["records"] };
  }

  contributions(): StakeholderContribution[] {
    return this.#sql.exec<{ payload: string }>("SELECT payload FROM contributions ORDER BY rowid")
      .toArray().map((row) => JSON.parse(row.payload) as StakeholderContribution);
  }

  /** Called in the project's transaction, so records, interviews and deadline events commit together. */
  writeKnowledge(next: ProjectKnowledge, graphRevision: number): void {
    const before = this.knowledge();
    this.#sql.exec("UPDATE project_knowledge SET revision = ?, records = ? WHERE id = 1", next.revision, JSON.stringify(next.records));
    for (const old of before.records) {
      if (old.kind !== "question") continue;
      const current = next.records.find((record) => record.id === old.id);
      if (current?.kind !== "question" || current.status !== "open" ||
          current.text !== old.text || current.stakeholderId !== old.stakeholderId) {
        this.#sql.exec("DELETE FROM interviews WHERE question_id = ?", old.id);
      }
    }
    for (const question of next.records) {
      if (question.kind !== "question" || question.status !== "open") continue;
      this.#sql.exec("INSERT OR IGNORE INTO interviews VALUES (?, ?, ?)", question.id, crypto.randomUUID(), graphRevision);
      if (question.dueAt !== undefined) {
        const baseline = this.#interview(question.id).baseline_revision;
        this.#enqueue({ id: `deadline:${question.id}:${baseline}:${question.dueAt}`, kind: "deadline", questionId: question.id, baselineRevision: baseline }, question.dueAt, question.dueAt);
      }
    }
  }

  interviewUrl(projectId: string, questionId: string): string {
    const { token } = this.#interview(questionId);
    return `process://interview/${projectId}/${questionId}?token=${token}`;
  }

  interviewContext(questionId: string, token: string, projectName: string): InterviewContext {
    const { baseline_revision } = this.#interview(questionId, token);
    const knowledge = this.knowledge();
    const question = findQuestion(knowledge, questionId);
    const stakeholder = knowledge.records.find((record) => record.id === question.stakeholderId);
    if (stakeholder?.kind !== "stakeholder") throw new Error("Interview stakeholder is unavailable.");
    const contributions = this.#sql.exec<{ payload: string }>(
      "SELECT payload FROM contributions WHERE interview_token = ? ORDER BY rowid", token,
    ).toArray().map((row) => JSON.parse(row.payload) as StakeholderContribution);
    return { projectName, question: question.text, stakeholderName: stakeholder.name, baselineRevision: baseline_revision, contributions };
  }

  prepareContribution(questionId: string, token: string, requestId: string, statement: string, projectName: string): StakeholderContribution {
    if (!requestId.trim() || requestId.length > 128) throw new Error("A reply request ID must be 1-128 characters.");
    if (!statement.trim() || statement.length > 8000) throw new Error("A reply must be 1-8000 characters.");
    const context = this.interviewContext(questionId, token, projectName);
    const existing = context.contributions.find((reply) => reply.requestId === requestId);
    if (existing) {
      if (existing.statement !== statement) throw new Error("This reply request ID already has different text.");
      return existing;
    }
    return {
      id: crypto.randomUUID(), questionId, questionText: context.question,
      stakeholderId: findQuestion(this.knowledge(), questionId).stakeholderId,
      stakeholderName: context.stakeholderName, requestId, statement,
      baselineRevision: context.baselineRevision, submittedAt: Date.now(),
    };
  }

  /** Testimony is append-only, approved by the interview's own Workshop session, never a map edit. */
  contribute(questionId: string, token: string, contribution: StakeholderContribution): void {
    this.#interview(questionId, token);
    const existing = this.#sql.exec<{ payload: string }>(
      "SELECT payload FROM contributions WHERE interview_token = ? AND request_id = ?", token, contribution.requestId,
    ).toArray()[0];
    if (existing) {
      if ((JSON.parse(existing.payload) as StakeholderContribution).statement !== contribution.statement) {
        throw new Error("This reply request ID already has different text.");
      }
      return;
    }
    this.storage.transactionSync(() => {
      this.#sql.exec("INSERT INTO contributions VALUES (?, ?, ?, ?)", contribution.id, token, contribution.requestId, JSON.stringify(contribution));
      this.#enqueue({ id: `reply:${contribution.id}`, kind: "reply", questionId, contributionId: contribution.id }, Date.now());
    });
  }

  status(): InvestigationStatus {
    return {
      enabled: this.storage.kv.get<Watch>("investigationWatch") !== undefined,
      pending: this.#sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM investigation_events WHERE status = 'pending'").one().count,
      failed: this.#sql.exec<{ payload: string }>("SELECT payload FROM investigation_events WHERE status = 'failed' ORDER BY rowid")
        .toArray().map((row) => JSON.parse(row.payload) as InvestigationEvent),
    };
  }

  async setWatch(id: string, initiator: Initiator | null): Promise<void> {
    if (initiator) {
      this.storage.kv.put("investigationWatch", { id, initiator });
      this.#enqueue({ id: `resumed:${id}:${crypto.randomUUID()}`, kind: "resumed" }, Date.now());
    } else if (this.storage.kv.get<Watch>("investigationWatch")?.id === id) {
      this.storage.kv.delete("investigationWatch");
    }
    await this.schedule();
  }

  async schedule(): Promise<void> {
    if (!this.storage.kv.get<Watch>("investigationWatch")) {
      await this.storage.deleteAlarm();
      return;
    }
    const due = this.#sql.exec<{ due: number | null }>(
      "SELECT MIN(due_at) AS due FROM investigation_events WHERE status = 'pending'",
    ).one().due;
    if (due === null) await this.storage.deleteAlarm();
    else await this.storage.setAlarm(Math.max(Date.now() + 1, due));
  }

  async alarm(): Promise<void> {
    const rows = this.#sql.exec<EventRow>(
      "SELECT * FROM investigation_events WHERE status = 'pending' AND due_at <= ? ORDER BY due_at, rowid LIMIT 20", Date.now(),
    ).toArray();
    for (const row of rows) {
      const watch = this.storage.kv.get<Watch>("investigationWatch");
      if (!watch) break;
      const event = JSON.parse(row.payload) as InvestigationEvent;
      if (!this.#relevant(event, row.deadline)) {
        this.#sql.exec("UPDATE investigation_events SET status = 'superseded' WHERE id = ?", row.id);
        continue;
      }
      try {
        // @ts-expect-error Worker RPC promises are disposable; the mapped type omits that marker.
        using hookCall = watch.initiator.startHook();
        const firing = await hookCall;
        await firing.approvalQueue.authorizeObservation({
          title: "Process investigation needs attention",
          description: `Investigation event ${event.id}: ${event.kind}. Read current project context before acting.`,
        });
        // Workshop rechecks live hook admission on both calls. A concurrent disable cannot grant authority.
        await firing.callback.onInvestigation(event);
        this.#sql.exec("UPDATE investigation_events SET status = 'delivered' WHERE id = ?", row.id);
      } catch (error) {
        const attempt = row.attempts + 1;
        logger.error("Investigation callback failed", { event: "investigation.callback.failed", eventId: row.id, attempt, error });
        this.#sql.exec(
          "UPDATE investigation_events SET attempts = ?, status = ?, due_at = ? WHERE id = ?",
          attempt, attempt >= 8 ? "failed" : "pending", Date.now() + Math.min(300_000, 2000 * 2 ** attempt), row.id,
        );
      }
    }
    await this.schedule();
  }

  #interview(questionId: string, token?: string): { token: string; baseline_revision: number } {
    const question = findQuestion(this.knowledge(), questionId);
    const row = this.#sql.exec<{ token: string; baseline_revision: number }>("SELECT * FROM interviews WHERE question_id = ?", questionId).toArray()[0];
    const matches = token === undefined || (row !== undefined && token.length === row.token.length &&
      crypto.subtle.timingSafeEqual(new TextEncoder().encode(token), new TextEncoder().encode(row.token)));
    if (question.status !== "open" || !row || !matches) {
      throw new Error("Interview not found or no longer open.");
    }
    return row;
  }

  #enqueue(event: InvestigationEvent, due: number, deadline?: number): void {
    this.#sql.exec(
      "INSERT OR IGNORE INTO investigation_events (id, payload, due_at, deadline) VALUES (?, ?, ?, ?)",
      event.id, JSON.stringify(event), due, deadline ?? null,
    );
  }

  #relevant(event: InvestigationEvent, deadline: number | null): boolean {
    if (!event.questionId) return true;
    const question = this.knowledge().records.find((record) => record.id === event.questionId);
    if (question?.kind !== "question" || question.status !== "open") return false;
    const interview = this.#interview(question.id);
    if (event.kind === "deadline") return question.dueAt === deadline && interview.baseline_revision === event.baselineRevision;
    if (event.kind === "reply") {
      return this.#sql.exec("SELECT 1 FROM contributions WHERE id = ? AND interview_token = ?", event.contributionId ?? "", interview.token).toArray().length > 0;
    }
    return true;
  }
}
