import { DurableObject } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import type { ProjectSummary } from "./types.js";

const MAX_LISTED_PROJECTS = 500;

/** Per-account index of the projects an account belongs to. Membership authority stays with each project. */
@validateRpc()
export class AccountProjectsDO extends DurableObject<Cloudflare.Env> {
  readonly #sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.#sql = ctx.storage.sql;
    this.#ensureSchema();
  }

  /** Records or refreshes a project; out-of-order updates never move `updatedAt` backwards. */
  upsert(summary: ProjectSummary): void {
    this.#sql.exec(
      `INSERT INTO projects (project_id, name, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
       WHERE excluded.updated_at >= projects.updated_at`,
      summary.projectId, summary.name, summary.updatedAt,
    );
  }

  /** Drops a project from this account's index. */
  remove(projectId: string): void {
    this.#sql.exec("DELETE FROM projects WHERE project_id = ?", projectId);
  }

  /** Lists indexed projects, most recently updated first. */
  list(): ProjectSummary[] {
    return this.#sql.exec<{ project_id: string; name: string; updated_at: number }>(
      "SELECT project_id, name, updated_at FROM projects ORDER BY updated_at DESC LIMIT ?",
      MAX_LISTED_PROJECTS,
    ).toArray().map((row) => ({
      projectId: row.project_id,
      name: row.name,
      updatedAt: row.updated_at,
    }));
  }

  /** Deletes the whole index. */
  async clear(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.#ensureSchema();
  }

  #ensureSchema(): void {
    this.#sql.exec(`CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  }
}
