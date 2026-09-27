import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Plus } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import type { ProjectSummary } from '@gadgets/gatekeeper-process/types'
import { useDocumentTitle } from '../useDocumentTitle'
import { reportIssue } from '../errorReporting'
import { PROCESS_STUDIO_APP_ID, useProcessStudio } from '../ba-studio/useProcessStudio'
import { Card } from '../ba-studio/ui'

/** BA Projects home: the caller's Process Studio projects and a form to start a new one. */
export const Route = createFileRoute('/ba-projects/')({
  component: BaProjectsPage,
})

function BaProjectsPage() {
  useDocumentTitle('BA Projects')
  const studio = useProcessStudio()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const ui = studio.ui

  useEffect(() => {
    if (!ui) return
    let cancelled = false
    setProjects(null)
    setListError(null)
    ui.stub
      .listProjects()
      .then((list) => {
        if (!cancelled) setProjects(list)
      })
      .catch((err: unknown) => {
        reportIssue('ba-projects.list', err, { gatekeeperVendorId: PROCESS_STUDIO_APP_ID })
        if (!cancelled) setListError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [ui])

  const openProject = (projectId: string) => navigate({ to: '/ba-projects/$projectId', params: { projectId } })

  const createProject = async () => {
    if (!ui || !name.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const project = await ui.stub.createProject(name.trim())
      openProject(project.projectId)
    } catch (err) {
      reportIssue('ba-projects.create', err, { gatekeeperVendorId: PROCESS_STUDIO_APP_ID })
      setCreateError(err instanceof Error ? err.message : String(err))
      setCreating(false)
    }
  }

  const error = studio.status === 'error' ? studio.error : listError
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
            disabled={creating || !ui || !name.trim()}
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
                <li key={project.projectId}>
                  <button
                    type="button"
                    onClick={() => openProject(project.projectId)}
                    className="flex w-full items-center justify-between gap-4 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-kumo-tint"
                  >
                    <p className="min-w-0 truncate text-[13px] font-medium text-kumo-default">{project.name}</p>
                    <span className="inline-flex shrink-0 items-center gap-2 text-[11.5px] text-kumo-inactive">
                      Updated {new Date(project.updatedAt).toLocaleString()}
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
