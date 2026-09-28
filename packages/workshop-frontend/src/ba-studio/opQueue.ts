import { applyGraphOps, GraphOpError, type GraphOpOptions } from '@gadgets/gatekeeper-process/graph-ops'
import type { GraphOp, ProcessGraph } from '@gadgets/gatekeeper-process/types'
import type { ApplyResult, OpBatch, ProjectChange, ProjectSnapshot } from '@gadgets/gatekeeper-process/ui-types'

export type SaveStatus = 'saved' | 'saving' | 'error' | 'conflict'

/** What the canvas renders: the confirmed snapshot with pending edits applied on top. */
export type QueueView = {
  snapshot: ProjectSnapshot
  /** Last revision the server confirmed. */
  revision: number
  saveStatus: SaveStatus
  /** Why the last save failed or was rejected. */
  error?: string
}

export type LocalApplyResult = { ok: true } | { ok: false; reason: string }

type SentBatch = {
  clientOpId: string
  ops: GraphOp[]
  /** How many leading `#pending` batches this send covers; zeroed once they leave `#pending`. */
  count: number
  /** The server accepted it at a revision past ones we haven't received; wait for the echo. */
  acked: boolean
  /** Already folded into the confirmed state (by the result, the echo, or a reset). */
  committed: boolean
}

const REBASE_CONFLICT = 'Someone else changed the same part of the map, so your unsaved edits were discarded.'

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Folds one committed change into a snapshot. The server validated it, so locks are not checked. */
function advance(snapshot: ProjectSnapshot, change: ProjectChange): ProjectSnapshot {
  const graph = change.ops.length > 0 ? applyGraphOps(snapshot.graph, change.ops, { allowLocked: true }) : snapshot.graph
  let decisions = snapshot.decisions
  const superseded = new Set(change.supersededDecisionIds ?? [])
  if (superseded.size > 0) {
    decisions = decisions.map((decision) =>
      superseded.has(decision.decisionId)
        ? { ...decision, status: 'superseded' as const, supersededBy: change.decision?.decisionId }
        : decision,
    )
  }
  if (change.decision) decisions = [change.decision, ...decisions]
  let openQuestions = snapshot.openQuestions
  if (change.questionRaised) openQuestions = [...openQuestions, change.questionRaised]
  const resolved = change.questionResolved
  if (resolved) openQuestions = openQuestions.filter((question) => question.questionId !== resolved.questionId)
  return { ...snapshot, graph: { ...graph, revision: change.revision }, decisions, openQuestions }
}

/**
 * Applies canvas edits optimistically and saves them to the server one batch at a time, folding in
 * live changes from other editors and rebasing unsaved edits on top of them.
 */
export class OpQueue {
  #confirmed: ProjectSnapshot
  #optimistic: ProcessGraph
  #pending: GraphOp[][] = []
  #inFlight: SentBatch | null = null
  #status: SaveStatus = 'saved'
  #error: string | undefined
  #disposed = false
  readonly #send: (batch: OpBatch) => Promise<ApplyResult>
  readonly #onChange: (view: QueueView) => void
  readonly #newId: () => string

  constructor(
    snapshot: ProjectSnapshot,
    send: (batch: OpBatch) => Promise<ApplyResult>,
    onChange: (view: QueueView) => void,
    newId: () => string = () => crypto.randomUUID(),
  ) {
    this.#confirmed = snapshot
    this.#optimistic = snapshot.graph
    this.#send = send
    this.#onChange = onChange
    this.#newId = newId
  }

  get view(): QueueView {
    return {
      snapshot: { ...this.#confirmed, graph: this.#optimistic },
      revision: this.#confirmed.graph.revision,
      saveStatus: this.#status,
      error: this.#error,
    }
  }

  /** Applies `ops` locally and queues them for saving; rejects edits the server would refuse. */
  apply(ops: GraphOp[]): LocalApplyResult {
    if (ops.length === 0) return { ok: true }
    try {
      this.#optimistic = applyGraphOps(this.#optimistic, ops, this.#lockOptions())
    } catch (err) {
      return { ok: false, reason: err instanceof GraphOpError ? err.message : String(err) }
    }
    this.#pending.push(ops)
    this.#status = 'saving'
    this.#error = undefined
    this.#emit()
    this.#flush()
    return { ok: true }
  }

  /** Resends edits that failed to save. */
  retry(): void {
    if (this.#status !== 'error') return
    this.#status = 'saving'
    this.#error = undefined
    this.#emit()
    this.#flush()
  }

  /** Folds in a change pushed by the server; the echo of our own in-flight batch confirms it. */
  applyRemote(change: ProjectChange): void {
    if (this.#disposed || change.revision <= this.#confirmed.graph.revision) return
    const sent = this.#inFlight
    const own = sent !== null && change.clientOpId === sent.clientOpId
    this.#confirmed = advance(this.#confirmed, change)
    if (own) {
      this.#pending.splice(0, sent.count)
      sent.count = 0
      sent.committed = true
    }
    this.#rebase()
    if (own && sent.acked) this.#settle()
    else this.#emit()
  }

  /** Replaces all state with a fresh server snapshot, discarding unsaved edits. */
  reset(snapshot: ProjectSnapshot): void {
    if (this.#disposed || snapshot.graph.revision < this.#confirmed.graph.revision) return
    this.#confirmed = snapshot
    this.#optimistic = snapshot.graph
    this.#pending = []
    if (this.#inFlight) {
      this.#inFlight.count = 0
      this.#inFlight.committed = true
    }
    if (this.#status === 'saving') this.#status = 'saved'
    this.#emit()
  }

  /** Stops reporting changes; results of an in-flight save are ignored. */
  dispose(): void {
    this.#disposed = true
  }

  #lockOptions(): GraphOpOptions {
    const active = this.#confirmed.decisions.filter((decision) => decision.status === 'active' && decision.locked)
    return {
      lockedNodeIds: active.flatMap((decision) => decision.nodeIds),
      lockedEdgeIds: active.flatMap((decision) => decision.edgeIds),
    }
  }

  #rebase(): void {
    try {
      this.#optimistic =
        this.#pending.length > 0
          ? applyGraphOps(this.#confirmed.graph, this.#pending.flat(), this.#lockOptions())
          : this.#confirmed.graph
    } catch {
      this.#pending = []
      if (this.#inFlight) this.#inFlight.count = 0
      this.#optimistic = this.#confirmed.graph
      this.#status = 'conflict'
      this.#error = REBASE_CONFLICT
    }
  }

  /** Ends the in-flight send and starts the next one. */
  #settle(): void {
    this.#inFlight = null
    if (this.#status === 'saving' && this.#pending.length === 0) this.#status = 'saved'
    this.#emit()
    this.#flush()
  }

  #flush(): void {
    if (this.#inFlight || this.#pending.length === 0 || this.#disposed) return
    const sent: SentBatch = {
      clientOpId: this.#newId(),
      ops: this.#pending.flat(),
      count: this.#pending.length,
      acked: false,
      committed: false,
    }
    this.#inFlight = sent
    this.#send({ clientOpId: sent.clientOpId, baseRevision: this.#confirmed.graph.revision, ops: sent.ops }).then(
      (result) => this.#onResult(sent, result),
      (err: unknown) => {
        if (this.#disposed) return
        if (sent.committed) return this.#settle()
        this.#inFlight = null
        this.#status = 'error'
        this.#error = messageOf(err)
        this.#emit()
      },
    )
  }

  #onResult(sent: SentBatch, result: ApplyResult): void {
    if (this.#disposed) return
    if (!result.ok) {
      this.#inFlight = null
      if (result.snapshot.graph.revision >= this.#confirmed.graph.revision) this.#confirmed = result.snapshot
      this.#optimistic = this.#confirmed.graph
      this.#pending = []
      this.#status = 'conflict'
      this.#error = result.reason
      this.#emit()
      return
    }
    if (!sent.committed) {
      const next = this.#confirmed.graph.revision + 1
      if (result.revision > next) {
        // Changes we haven't received landed first; their echoes arrive before ours.
        sent.acked = true
        return
      }
      if (result.revision === next) {
        this.#confirmed = advance(this.#confirmed, { revision: result.revision, source: 'user', ops: sent.ops })
        this.#pending.splice(0, sent.count)
        sent.count = 0
        sent.committed = true
        this.#rebase()
      }
    }
    this.#settle()
  }

  #emit(): void {
    if (!this.#disposed) this.#onChange(this.view)
  }
}
