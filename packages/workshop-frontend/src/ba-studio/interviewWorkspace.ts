import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { findProcessAccountId } from './processWorkspace'
import { reportIssue } from '../errorReporting'

const pending = new WeakMap<RpcStub<AuthenticatedApi>, Map<string, Promise<string>>>()

/** Validates an invitation without sending its bearer token to logging or a server URL. */
export const interviewResourceFrom = (fragment: string): string => {
  let resource: string
  try {
    resource = decodeURIComponent(fragment.replace(/^#/, ''))
  } catch {
    throw new Error('This interview invitation is malformed.')
  }
  const url = URL.parse(resource)
  if (resource.length > 300 || !url || url.protocol !== 'process:' || url.hostname !== 'interview' ||
      url.username || url.password || url.port || url.hash ||
      url.searchParams.size !== 1 ||
      !/^\/[A-Za-z0-9-]{1,64}\/[A-Za-z0-9_-]{1,64}$/.test(url.pathname) ||
      !/^[a-f0-9-]{36}$/.test(url.searchParams.get('token') ?? '')) {
    throw new Error('This interview invitation is incomplete or invalid.')
  }
  return resource
}

/** Creates an isolated Workshop conversation with a question-only binding; never the agreed map. */
export const openInterviewWorkspace = (api: RpcStub<AuthenticatedApi>, resource: string): Promise<string> => {
  let requests = pending.get(api)
  if (!requests) {
    requests = new Map()
    pending.set(api, requests)
  }
  const existing = requests.get(resource)
  if (existing) return existing
  const create = async () => {
    const accountId = await findProcessAccountId(api)
    const overseer = api.newGadget()
    const gadget = overseer.createGadget('Stakeholder interview', undefined, 'INTERVIEW')
    try {
      const gatekeeper = await overseer.newGatekeeper(accountId, resource)
      if (!gatekeeper) throw new Error('The interview could not be connected.')
      try {
        await gadget.bind('PROCESS_INTERVIEW', gatekeeper.getId())
        await overseer.setTitle('Stakeholder interview')
        return (await overseer.getMetadata()).id
      } finally {
        gatekeeper[Symbol.dispose]()
      }
    } catch (error) {
      try { await overseer.deleteSelf() }
      catch (cleanupError) { reportIssue('ba-studio.interview-cleanup', cleanupError) }
      throw error
    } finally {
      gadget[Symbol.dispose]()
      overseer[Symbol.dispose]()
    }
  }
  const request = create().catch((error: unknown) => {
    requests.delete(resource)
    throw error
  })
  requests.set(resource, request)
  return request
}
