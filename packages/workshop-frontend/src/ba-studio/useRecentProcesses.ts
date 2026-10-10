import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, GadgetMetadataWithTimestamps } from '@gadgets/workshop-shared/api'
import { reportIssue } from '../errorReporting'
import { filterProcessWorkspaces, PROCESS_VENDOR_ID } from './processWorkspace'

export type RecentProcesses =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; processes: GadgetMetadataWithTimestamps[] }

/** The person's process workspaces, most recently active first. */
export function useRecentProcesses(api: RpcStub<AuthenticatedApi>): RecentProcesses {
  const [state, setState] = useState<RecentProcesses>({ status: 'loading' })
  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    api.listGadgets()
      .then((workspaces) => filterProcessWorkspaces(api, workspaces))
      .then((processes) => {
        if (!cancelled) {
          setState({ status: 'ready', processes: processes.toSorted((a, b) => b.lastActive.getTime() - a.lastActive.getTime()) })
        }
      })
      .catch((err: unknown) => {
        reportIssue('ba-studio.recent', err, { gatekeeperVendorId: PROCESS_VENDOR_ID })
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [api])
  return state
}
