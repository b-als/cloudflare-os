import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Plus } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import type { GadgetMetadataWithTimestamps } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from '../AuthContext'
import { useDocumentTitle } from '../useDocumentTitle'
import { reportIssue } from '../errorReporting'
import { createProcessWorkspace, filterProcessWorkspaces, PROCESS_VENDOR_ID } from '../ba-studio/processWorkspace'
import { Card } from '../ba-studio/ui'

/** BA Projects home: the caller's process workspaces and a form to start a new one. */
export const Route = createFileRoute('/ba-projects/')({
  component: BaProjectsPage,
})

function BaProjectsPage() {
  useDocumentTitle('BA Projects')
  const { authenticatedApi } = useAuthenticatedApi()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<GadgetMetadataWithTimestamps[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setProjects(null)
    setListError(null)
    authenticatedApi
      .listGadgets()
      .then((list) => filterProcessWorkspaces(authenticatedApi, list))
      .then((list) => {
        if (!cancelled) setProjects(list.toSorted((a, b) => b.lastActive.getTime() - a.lastActive.getTime()))
      })
      .catch((err: unknown) => {
        reportIssue('ba-projects.list', err, { gatekeeperVendorId: PROCESS_VENDOR_ID })
        if (!cancelled) setListError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [authenticatedApi])

  const openProject = (workspaceId: string) => navigate({ to: '/ba-projects/$workspaceId', params: { workspaceId } })

  const createProject = async () => {
    if (!name.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      openProject(await createProcessWorkspace(authenticatedApi, name.trim()))
    } catch (err) {
      reportIssue('ba-projects.create', err, { gatekeeperVendorId: PROCESS_VENDOR_ID })
      setCreateError(err instanceof Error ? err.message : String(err))
      setCreating(false)
    }
  }

  const error = listError
  const empty = projects?.length === 0

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 pb-10 pt-10 sm:px-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-kumo-default">BA Projects</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle">
          Map business processes as swimlane diagrams with the people who run them.
        </p>
      </header>

      <Card title={empty ? 'Create your first process' : 'New process'}>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void createProject()
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Process name, e.g. Customer onboarding"
            aria-label="Process name"
            className="h-8 min-w-0 flex-1 rounded-lg border border-kumo-line bg-kumo-base px-3 text-[12.5px] text-kumo-default outline-none focus:border-kumo-brand"
          />
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-kumo-brand px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-kumo-brand-hover disabled:cursor-default disabled:opacity-60"
          >
            <Plus size={13} weight="bold" />
            {creating ? 'Creating…' : 'Create'}
          </button>
        </form>
        {createError && <p className="mt-2 text-[12px] text-kumo-danger">Couldn't create the project: {createError}</p>}
      </Card>

      {!empty && (
        <Card title="Your processes">
          {error ? (
            <p className="py-4 text-center text-[12.5px] text-kumo-danger">Couldn't load projects: {error}</p>
          ) : !projects ? (
            <p className="py-4 text-center text-[12.5px] text-kumo-subtle">Loading projects…</p>
          ) : (
            <ul className="divide-y divide-kumo-line">
              {projects.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => openProject(project.id)}
                    className="flex w-full items-center justify-between gap-4 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-kumo-tint"
                  >
                    <p className="min-w-0 truncate text-[13px] font-medium text-kumo-default">{project.title}</p>
                    <span className="inline-flex shrink-0 items-center gap-2 text-[11.5px] text-kumo-inactive">
                      {project.owner ? `Shared by ${project.owner.name} · ` : ''}
                      Updated {project.lastActive.toLocaleString()}
                      <ArrowRight size={12} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}
