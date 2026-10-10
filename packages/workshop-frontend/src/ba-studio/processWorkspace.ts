import { RpcTarget, type RpcStub } from 'capnweb'
import type {
  AuthenticatedApi,
  ConnectedAccountsSubscriber,
  GadgetBindingInfo,
  Overseer,
  WorkpieceId,
  WorkpieceSummary,
  WorkpiecesSubscriber,
} from '@gadgets/workshop-shared/api'

/** Vendor id of the in-repo Process Studio gatekeeper (packages/gatekeeper-process). */
export const PROCESS_VENDOR_ID = 'process'
/** Binding name of the process project, as the host gadget and every chat's agent see it. */
export const PROCESS_BINDING = 'PROCESS_PROJECT'
// Must differ from PROCESS_BINDING: a chat's env lists gadgets first, so a gadget named like its
// binding would shadow the project.
const HOST_GADGET_BINDING = 'PROCESS_MAP'

const LIST_CONCURRENCY = 4

/** Resolves the user's `process` account, provisioning the ambient account on first use. */
export function findProcessAccountId(api: RpcStub<AuthenticatedApi>): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false
    let subscription: { [Symbol.dispose](): void } | null = null
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      subscription?.[Symbol.dispose]()
      settle()
    }
    class Subscriber extends RpcTarget implements ConnectedAccountsSubscriber {
      add(id: number, _description: unknown, _vendor: unknown, _resources: unknown, _valid: boolean, vendorId: string) {
        if (vendorId === PROCESS_VENDOR_ID) finish(() => resolve(id))
      }
      remove() {}
      ready() {
        // The new account then arrives via add().
        if (!settled) api.provisionAmbientAccount(PROCESS_VENDOR_ID).catch((err: unknown) => finish(() => reject(err)))
      }
    }
    api
      .subscribeConnectedAccounts(new Subscriber(), { includeForcedAutoProvisionedAccounts: true })
      .then((stub) => {
        if (settled) stub[Symbol.dispose]()
        else subscription = stub
      })
      .catch((err: unknown) => finish(() => reject(err)))
  })
}

/** Creates a workspace holding one gadget bound to a new process project; returns the workspace id. */
export async function createProcessWorkspace(api: RpcStub<AuthenticatedApi>, name: string): Promise<string> {
  const accountId = await findProcessAccountId(api)
  const overseer = api.newGadget()
  const gadget = overseer.createGadget('Process map', undefined, HOST_GADGET_BINDING)
  const gatekeeper = await overseer.newGatekeeper(accountId, `process://new?name=${encodeURIComponent(name)}`)
  try {
    if (!gatekeeper) throw new Error('Process Studio could not create the project.')
    await Promise.all([gadget.bind(PROCESS_BINDING, gatekeeper.getId()), overseer.setTitle(name)])
    const { id } = await overseer.getMetadata()
    processWorkspaceCache.set(id, Promise.resolve(true))
    return id
  } finally {
    gadget[Symbol.dispose]()
    gatekeeper?.[Symbol.dispose]()
    overseer[Symbol.dispose]()
  }
}

function listGadgetIds(overseer: RpcStub<Overseer>): Promise<WorkpieceId[]> {
  return new Promise((resolve, reject) => {
    const ids = new Set<WorkpieceId>()
    let done = false
    let subscription: { [Symbol.dispose](): void } | null = null
    class Subscriber extends RpcTarget implements WorkpiecesSubscriber {
      entry(summary: WorkpieceSummary) {
        if (summary.type === 'gadget' && summary.chatId === undefined) ids.add(summary.id)
      }
      removed(id: WorkpieceId) {
        ids.delete(id)
      }
      ready() {
        if (done) return
        done = true
        subscription?.[Symbol.dispose]()
        resolve([...ids])
      }
    }
    overseer.subscribeToWorkpieces(new Subscriber()).then(
      (stub) => {
        if (done) stub[Symbol.dispose]()
        else subscription = stub
      },
      (err: unknown) => {
        if (done) return
        done = true
        reject(err)
      },
    )
  })
}

/** Finds the binding to a process project on any of the workspace's gadgets. */
export async function findProcessBinding(overseer: RpcStub<Overseer>): Promise<GadgetBindingInfo | null> {
  for (const gadgetId of await listGadgetIds(overseer)) {
    const gadget = overseer.getGadget(gadgetId)
    try {
      const binding = (await gadget.listBindings()).find((candidate) => candidate.vendorId === PROCESS_VENDOR_ID)
      if (binding) return binding
    } finally {
      gadget[Symbol.dispose]()
    }
  }
  return null
}

// Workspace id -> whether it holds a process project; failed checks are not cached.
const processWorkspaceCache = new Map<string, Promise<boolean>>()

function isProcessWorkspace(api: RpcStub<AuthenticatedApi>, workspaceId: string): Promise<boolean> {
  let cached = processWorkspaceCache.get(workspaceId)
  if (!cached) {
    const overseer = api.openGadget(workspaceId)
    cached = findProcessBinding(overseer)
      .then((binding) => binding !== null)
      .catch(() => {
        processWorkspaceCache.delete(workspaceId)
        return false
      })
      .finally(() => overseer[Symbol.dispose]())
    processWorkspaceCache.set(workspaceId, cached)
  }
  return cached
}

/** Keeps the workspaces that hold a process project, checking a few at a time. */
export async function filterProcessWorkspaces<T extends { id: string }>(
  api: RpcStub<AuthenticatedApi>,
  workspaces: T[],
): Promise<T[]> {
  const matches: boolean[] = []
  let next = 0
  const worker = async () => {
    while (next < workspaces.length) {
      const index = next++
      matches[index] = await isProcessWorkspace(api, workspaces[index].id)
    }
  }
  await Promise.all(Array.from({ length: Math.min(LIST_CONCURRENCY, workspaces.length) }, worker))
  return workspaces.filter((_, index) => matches[index])
}
