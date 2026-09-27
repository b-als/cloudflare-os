import { applyGraphOps, GraphOpError, type GraphOpOptions } from '@gadgets/gatekeeper-process/graph-ops'
import type { GraphOp, ProcessGraph } from '@gadgets/gatekeeper-process/types'
import type { ApplyResult, OpBatch, ProjectSnapshot } from '@gadgets/gatekeeper-process/ui-types'

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

/**
 * Applies canvas edits optimistically and saves them to the server one batch at a time, each
 * against the last confirmed revision.
 */
export class OpQueue {
  #confirmed: ProjectSnapshot
  #optimistic: ProcessGraph
  #pending: GraphOp[][] = []
  #inFlight = false
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
    if (this.#confirmed.role === 'viewer') return { ok: false, reason: 'Viewers cannot edit this project.' }
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

  /** Stops reporting changes; results of an in-flight save are ignored. */
  dispose(): void {
    this.#disposed = true
  }

  #lockOptions(): GraphOpOptions {
    const active = this.#confirmed.decisions.filter((decision) => decision.status === 'active')
    return {
      lockedNodeIds: active.flatMap((decision) => decision.nodeIds),
      lockedEdgeIds: active.flatMap((decision) => decision.edgeIds),
      allowLocked: this.#confirmed.role === 'owner',
    }
  }

  #flush(): void {
    if (this.#inFlight || this.#pending.length === 0 || this.#disposed) return
    const sentCount = this.#pending.length
    const ops = this.#pending.flat()
    const baseRevision = this.#confirmed.graph.revision
    this.#inFlight = true
    this.#send({ clientOpId: this.#newId(), baseRevision, ops }).then(
      (result) => {
        this.#inFlight = false
        if (this.#disposed) return
        if (result.ok) {
          const graph = applyGraphOps(this.#confirmed.graph, ops, { allowLocked: true })
          this.#confirmed = { ...this.#confirmed, graph: { ...graph, revision: result.revision } }
          this.#pending.splice(0, sentCount)
          this.#optimistic = { ...this.#optimistic, revision: result.revision }
          this.#status = this.#pending.length > 0 ? 'saving' : 'saved'
          this.#emit()
          this.#flush()
        } else {
          this.#confirmed = result.snapshot
          this.#optimistic = result.snapshot.graph
          this.#pending = []
          this.#status = 'conflict'
          this.#error = result.reason
          this.#emit()
        }
      },
      (err: unknown) => {
        this.#inFlight = false
        if (this.#disposed) return
        this.#status = 'error'
        this.#error = err instanceof Error ? err.message : String(err)
        this.#emit()
      },
    )
  }

  #emit(): void {
    if (!this.#disposed) this.#onChange(this.view)
  }
}
