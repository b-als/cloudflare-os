import { useCallback, useEffect, useRef, useState } from 'react'
import { RpcTarget, type RpcStub } from 'capnweb'
import type { Overseer } from '@gadgets/workshop-shared/api'
import type { GraphOp } from '@gadgets/gatekeeper-process/types'
import type {
  ApplyResult,
  PendingPreview,
  ProjectChange,
  ProjectHandle,
  ProjectSnapshot,
  ProjectSubscriber,
} from '@gadgets/gatekeeper-process/ui-types'
import { reportIssue } from '../errorReporting'
import { OpQueue, type LocalApplyResult, type QueueView } from './opQueue'
import { findProcessBinding, PROCESS_VENDOR_ID } from './processWorkspace'

// Proposals arrive through the approval queue, which has no subscription the map can use, so the
// preview is polled; a committed change also refreshes it at once (see `onCommitted`).
const PENDING_PREVIEW_INTERVAL_MS = 3000

class QueueSubscriber extends RpcTarget implements ProjectSubscriber {
  constructor(private readonly queue: OpQueue, private readonly onCommitted: () => void) {
    super()
  }
  changed(change: ProjectChange) {
    this.queue.applyRemote(change)
    this.onCommitted()
  }
  reset(snapshot: ProjectSnapshot) {
    this.queue.reset(snapshot)
    this.onCommitted()
  }
}

export type ProcessProjectState = {
  /** The project as this client sees it, including its own unsaved edits. */
  view: QueueView | null
  loadError: string | null
  /** Whether committed changes from the agent and other people are streaming in. */
  live: boolean
  /** How the agent's pending proposals would change the map. */
  pendingPreview: PendingPreview | null
  applyOps: (ops: GraphOp[]) => LocalApplyResult
  retry: () => void
  /** Recomputes step positions from the flow; the result arrives through the live stream. */
  layout: () => Promise<ApplyResult | null>
}

/** Opens the workspace's process project, saves direct map edits, and folds in live changes. */
export function useProcessProject(overseer: { stub: RpcStub<Overseer> } | null): ProcessProjectState {
  const [view, setView] = useState<QueueView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(null)
  const queueRef = useRef<OpQueue | null>(null)
  const handleRef = useRef<RpcStub<ProjectHandle> | null>(null)

  useEffect(() => {
    if (!overseer) return
    let cancelled = false
    const held: Array<{ [Symbol.dispose](): void }> = []
    const hold = <T extends { [Symbol.dispose](): void }>(stub: T): T => {
      if (cancelled) stub[Symbol.dispose]()
      else held.push(stub)
      return stub
    }
    setView(null)
    setLoadError(null)
    setLive(false)
    setPendingPreview(null)

    // Responses can return out of order; only the newest request may update the preview.
    let previewRequest = 0
    const refreshPreview = () => {
      const handle = handleRef.current
      if (cancelled || !handle) return
      const request = ++previewRequest
      handle.previewPending().then((preview) => {
        if (!cancelled && request === previewRequest) setPendingPreview(preview)
      }).catch((err: unknown) => {
        reportIssue('ba-studio.preview-pending', err, { gatekeeperVendorId: PROCESS_VENDOR_ID })
      })
    }

    const load = async () => {
      const binding = await findProcessBinding(overseer.stub)
      if (cancelled) return
      if (!binding) throw new Error('This workspace has no process map.')
      const gatekeeper = hold(overseer.stub.getGatekeeperById(binding.target))
      const frame = await gatekeeper.openUi()
      const handle = hold(frame.ui as unknown as RpcStub<ProjectHandle>)
      if (cancelled) return
      handleRef.current = handle
      const snapshot = await handle.snapshot()
      if (cancelled) return
      const queue = new OpQueue(snapshot, (batch) => handle.applyOps(batch), setView)
      queueRef.current = queue
      setView(queue.view)
      try {
        hold(await handle.subscribe(new QueueSubscriber(queue, refreshPreview), snapshot.graph.revision))
        if (!cancelled) setLive(true)
      } catch (err) {
        reportIssue('ba-studio.subscribe', err, { gatekeeperVendorId: PROCESS_VENDOR_ID })
      }
      if (cancelled) return
      refreshPreview()
      const interval = setInterval(refreshPreview, PENDING_PREVIEW_INTERVAL_MS)
      held.push({ [Symbol.dispose]: () => clearInterval(interval) })
    }
    load().catch((err: unknown) => {
      if (cancelled) return
      reportIssue('ba-studio.open', err, { gatekeeperVendorId: PROCESS_VENDOR_ID })
      setLoadError(err instanceof Error ? err.message : String(err))
    })
    return () => {
      cancelled = true
      queueRef.current?.dispose()
      queueRef.current = null
      handleRef.current = null
      for (const stub of held) stub[Symbol.dispose]()
    }
  }, [overseer])

  const applyOps = useCallback(
    (ops: GraphOp[]): LocalApplyResult =>
      queueRef.current?.apply(ops) ?? { ok: false, reason: 'The project is still loading.' },
    [],
  )
  const retry = useCallback(() => queueRef.current?.retry(), [])
  const layout = useCallback(() => handleRef.current?.layout() ?? Promise.resolve(null), [])

  return { view, loadError, live, pendingPreview, applyOps, retry, layout }
}
