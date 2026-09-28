import { useCallback, useEffect, useRef, useState } from 'react'
import { RpcTarget, type RpcStub } from 'capnweb'
import type { Overseer } from '@gadgets/workshop-shared/api'
import type { Decision, GraphOp } from '@gadgets/gatekeeper-process/types'
import type { ApplyResult, ProjectChange, ProjectHandle, ProjectSnapshot, ProjectSubscriber } from '@gadgets/gatekeeper-process/ui-types'
import { reportIssue } from '../errorReporting'
import { OpQueue, type LocalApplyResult, type QueueView } from './opQueue'
import { findProcessBinding, PROCESS_VENDOR_ID } from './processWorkspace'

class QueueSubscriber extends RpcTarget implements ProjectSubscriber {
  constructor(private readonly queue: OpQueue) {
    super()
  }
  changed(change: ProjectChange) {
    this.queue.applyRemote(change)
  }
  reset(snapshot: ProjectSnapshot) {
    this.queue.reset(snapshot)
  }
}

export type RecordDecisionInput = Parameters<ProjectHandle['recordDecision']>[0]

export type ProcessProjectState = {
  view: QueueView | null
  loadError: string | null
  /** Whether live changes from other editors are streaming in. */
  live: boolean
  applyOps: (ops: GraphOp[]) => LocalApplyResult
  retry: () => void
  /** Recomputes step positions from the flow. Live updates arrive via the usual subscription. */
  layout: () => Promise<ApplyResult | null>
  /** Locks the given elements under a new decision. */
  recordDecision: (input: RecordDecisionInput) => Promise<Decision>
  resolveQuestion: (questionId: string, answer: string) => Promise<void>
}

/** Opens the workspace's process project, saves canvas edits, and folds in live changes. */
export function useProcessProject(overseer: { stub: RpcStub<Overseer> } | null): ProcessProjectState {
  const [view, setView] = useState<QueueView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
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
        hold(await handle.subscribe(new QueueSubscriber(queue), snapshot.graph.revision))
        if (!cancelled) setLive(true)
      } catch (err) {
        reportIssue('process-studio.subscribe', err, { gatekeeperVendorId: PROCESS_VENDOR_ID })
      }
    }
    load().catch((err: unknown) => {
      if (cancelled) return
      reportIssue('process-studio.open', err, { gatekeeperVendorId: PROCESS_VENDOR_ID })
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
  const recordDecision = useCallback(
    (input: RecordDecisionInput) => {
      if (!handleRef.current) throw new Error('The project is still loading.')
      return handleRef.current.recordDecision(input)
    },
    [],
  )
  const resolveQuestion = useCallback(
    (questionId: string, answer: string) => {
      if (!handleRef.current) throw new Error('The project is still loading.')
      return handleRef.current.resolveQuestion(questionId, answer)
    },
    [],
  )

  return { view, loadError, live, applyOps, retry, layout, recordDecision, resolveQuestion }
}
