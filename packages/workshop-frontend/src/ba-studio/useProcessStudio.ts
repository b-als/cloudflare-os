import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import type { GraphOp } from '@gadgets/gatekeeper-process/types'
import type { ProcessStudioApi } from '@gadgets/gatekeeper-process/ui-types'
import { useAuthenticatedApi } from '../AuthContext'
import { reportIssue } from '../errorReporting'
import { OpQueue, type LocalApplyResult, type QueueView } from './opQueue'

/** Vendor id of the in-repo Process Studio gatekeeper (packages/gatekeeper-process). */
export const PROCESS_STUDIO_APP_ID = 'process'

export type ProcessStudioUi = { stub: RpcStub<ProcessStudioApi> }

export type ProcessStudioState =
  | { status: 'loading'; ui?: undefined; error?: undefined }
  | { status: 'ready'; ui: ProcessStudioUi; error?: undefined }
  | { status: 'error'; ui?: undefined; error: string }

function disposeFrame(frame: GatekeeperUiFrame | null) {
  ;(frame?.ui as { [Symbol.dispose]?(): void } | undefined)?.[Symbol.dispose]?.()
}

/** Acquires the Process Studio UI capability, provisioning the ambient account on first use. */
export function useProcessStudio(): ProcessStudioState {
  const { authenticatedApi } = useAuthenticatedApi()
  const [state, setState] = useState<{ frame: GatekeeperUiFrame } | { error: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    let acquired: GatekeeperUiFrame | null = null
    authenticatedApi
      .getGatekeeperApp(PROCESS_STUDIO_APP_ID)
      .then(async (existing) => {
        if (existing) return existing
        await authenticatedApi.provisionAmbientAccount(PROCESS_STUDIO_APP_ID)
        return authenticatedApi.getGatekeeperApp(PROCESS_STUDIO_APP_ID)
      })
      .then((frame) => {
        if (cancelled) {
          disposeFrame(frame)
          return
        }
        if (!frame) {
          setState({ error: 'Process Studio is not available on this deployment.' })
          return
        }
        acquired = frame
        setState({ frame })
      })
      .catch((err) => {
        reportIssue('process-studio.acquire-ui', err, { gatekeeperVendorId: PROCESS_STUDIO_APP_ID })
        if (!cancelled) setState({ error: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      cancelled = true
      disposeFrame(acquired)
      setState(null)
    }
  }, [authenticatedApi])

  return useMemo((): ProcessStudioState => {
    if (!state) return { status: 'loading' }
    if ('error' in state) return { status: 'error', error: state.error }
    return { status: 'ready', ui: { stub: state.frame.ui as RpcStub<ProcessStudioApi> } }
  }, [state])
}

export type ProcessProjectState = {
  view: QueueView | null
  loadError: string | null
  applyOps: (ops: GraphOp[]) => LocalApplyResult
  retry: () => void
}

/** Opens a project, holds its snapshot, and saves canvas edits through an `OpQueue`. */
export function useProcessProject(ui: ProcessStudioUi | undefined, projectId: string): ProcessProjectState {
  const [view, setView] = useState<QueueView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const queueRef = useRef<OpQueue | null>(null)

  useEffect(() => {
    if (!ui) return
    let cancelled = false
    const handle = ui.stub.openProject(projectId)
    setView(null)
    setLoadError(null)
    handle
      .snapshot()
      .then((snapshot) => {
        if (cancelled) return
        const queue = new OpQueue(snapshot, (batch) => handle.applyOps(batch), setView)
        queueRef.current = queue
        setView(queue.view)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
      queueRef.current?.dispose()
      queueRef.current = null
      handle[Symbol.dispose]()
    }
  }, [ui, projectId])

  const applyOps = useCallback(
    (ops: GraphOp[]): LocalApplyResult =>
      queueRef.current?.apply(ops) ?? { ok: false, reason: 'The project is still loading.' },
    [],
  )
  const retry = useCallback(() => queueRef.current?.retry(), [])

  return { view, loadError, applyOps, retry }
}
