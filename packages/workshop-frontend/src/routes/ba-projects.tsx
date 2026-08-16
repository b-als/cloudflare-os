import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Plus } from '@phosphor-icons/react'
import { useCallback, useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import { useAuthenticatedApi } from '../AuthContext'
import { useDocumentTitle } from '../useDocumentTitle'
import { reportIssue } from '../errorReporting'
import { BA_STUDIO_APP_ID, disposeFrame, type BaProjectSummary, type BaUiApi } from './workflow-studio'

/**
 * Main "BA Projects" management page: lists every BA Studio project on this
 * deployment (via the BA Studio gatekeeper's `listProjects()`, backed by the
 * `BaProjectRegistryDurableObject` registry) and lets the user create a new
 * one or select an existing one to open in Workflow Studio
 * (`/workflow-studio?process=<id>`). Mirrors the simple header + list
 * pattern used by `routes/workspaces.tsx` for the platform's own workspace
 * list, applied to BA Studio's project concept instead of gadget workspaces.
 */
export const Route = createFileRoute('/ba-projects')({
  component: BaProjectsPage,
})

function BaProjectsPage() {
  useDocumentTitle('BA Projects')
  const { authenticatedApi } = useAuthenticatedApi()
  const navigate = useNavigate()
  const [frame, setFrame] = useState<GatekeeperUiFrame | null>(null)
  const [projects, setProjects] = useState<BaProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Derive the ui capability fresh from `frame` on every render (mirrors workflow-studio.tsx)
  // rather than storing the extracted stub in its own state slot, which was found to hand out a
  // broken capnweb reference once round-tripped through React state.
  const ui = frame?.ui as RpcStub<BaUiApi> | undefined

  useEffect(() => {
    let cancelled = false
    let acquired: GatekeeperUiFrame | null = null
    // Mirrors workflow-studio.tsx's ambient-account acquisition: the BA Studio gatekeeper
    // auto-provisions on demand, so a fresh account has no app yet until provisioned once.
    authenticatedApi
      .getGatekeeperApp(BA_STUDIO_APP_ID)
      .then(async (frame) => {
        if (frame) return frame
        await authenticatedApi.provisionAmbientAccount(BA_STUDIO_APP_ID)
        return authenticatedApi.getGatekeeperApp(BA_STUDIO_APP_ID)
      })
      .then(async (frame) => {
        if (!frame) {
          if (!cancelled) setError('BA Studio gatekeeper app is not available on this deployment.')
          return
        }
        if (cancelled) {
          disposeFrame(frame)
          return
        }
        acquired = frame
        setFrame(frame)
        setLoading(true)
        try {
          setProjects(await (frame.ui as RpcStub<BaUiApi>).listProjects())
        } catch (err) {
          console.error('Failed to list BA Studio projects:', err)
          reportIssue('ba-projects.list', err, { gatekeeperVendorId: BA_STUDIO_APP_ID })
          setError(`${err}`)
        } finally {
          setLoading(false)
        }
      })
      .catch((err) => {
        console.error('Failed to acquire BA Studio UI capability:', err)
        reportIssue('ba-projects.acquire-ui', err, { gatekeeperVendorId: BA_STUDIO_APP_ID })
        if (!cancelled) setError(`${err}`)
      })
    return () => {
      cancelled = true
      disposeFrame(acquired)
    }
  }, [authenticatedApi])

  const createProject = useCallback(async () => {
    if (!ui) return
    const name = newProjectName.trim() || 'Untitled process'
    setCreating(true)
    setError(null)
    try {
      const record = await ui.createProject(name)
      setNewProjectName('')
      navigate({ to: '/workflow-studio', search: { process: record.processId } })
    } catch (err) {
      console.error('Failed to create BA Studio project:', err)
      reportIssue('ba-projects.create', err, { gatekeeperVendorId: BA_STUDIO_APP_ID })
      setError(`${err}`)
    } finally {
      setCreating(false)
    }
  }, [navigate, newProjectName, ui])

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-6 sm:px-10">
      <header className="flex flex-wrap items-end justify-between gap-4 px-3 pb-3 pt-10">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-kumo-default">BA Projects</h1>
          <p className="mt-1 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle">
            Each project is an isolated BA Studio process with its own requirements, conflicts,
            trade-offs, sign-off, and live workflow graph.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            placeholder="New project name"
            className="h-9 rounded-lg border border-kumo-line bg-kumo-base px-3 text-[13px] text-kumo-default"
          />
          <button
            type="button"
            onClick={() => void createProject()}
            disabled={creating || !ui}
            className="press inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-kumo-brand px-3.5 text-[13px] font-medium tracking-[-0.25px] text-white transition-colors hover:bg-kumo-brand-hover disabled:opacity-60"
          >
            <Plus size={14} weight="bold" />
            {creating ? 'Creating…' : 'New project'}
          </button>
        </div>
      </header>

      {error && <p className="px-3 text-[13px] text-rose-400">{error}</p>}

      <div className="min-h-0 flex-1 px-3 pb-10">
        {loading ? (
          <p className="py-10 text-center text-[13px] text-kumo-subtle">Loading projects…</p>
        ) : projects.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-kumo-subtle">
            No BA Studio projects yet. Create one above to open Workflow Studio and start talking
            to the BA agent.
          </p>
        ) : (
          <ul className="divide-y divide-kumo-line">
            {projects.map((project) => (
              <li key={project.processId}>
                <button
                  type="button"
                  onClick={() => navigate({ to: '/workflow-studio', search: { process: project.processId } })}
                  className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-3 text-left transition-colors hover:bg-kumo-elevated"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium text-kumo-default">{project.processName}</p>
                    <p className="mt-0.5 truncate text-[12px] text-kumo-subtle">{project.processId}</p>
                  </div>
                  <p className="shrink-0 text-[12px] text-kumo-inactive">
                    v{project.version} · updated {new Date(project.updatedAt).toLocaleString()}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
