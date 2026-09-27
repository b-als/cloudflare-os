import { useEffect, useRef, type ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useKumoToastManager } from '@cloudflare/kumo'
import { useDocumentTitle } from '../useDocumentTitle'
import AgentPanel from '../ba-studio/AgentPanel'
import ProcessCanvas from '../ba-studio/ProcessCanvas'
import type { QueueView } from '../ba-studio/opQueue'
import { useProcessProject, useProcessStudio } from '../ba-studio/useProcessStudio'
import { Pill, type Tone } from '../ba-studio/ui'

/** Focused process-mapping workspace: the project's live canvas beside the BA agent. */
export const Route = createFileRoute('/ba-projects/$projectId')({
  component: ProjectLayout,
})

const roleTone: Record<QueueView['snapshot']['role'], Tone> = { owner: 'brand', editor: 'info', viewer: 'neutral' }

function SaveStatus({ view, onRetry }: { view: QueueView; onRetry: () => void }) {
  switch (view.saveStatus) {
    case 'saved':
      return <Pill tone="success">Saved · rev {view.revision}</Pill>
    case 'saving':
      return <Pill>Saving…</Pill>
    case 'conflict':
      return (
        <Pill tone="warning" title={view.error}>
          Conflict — reloaded latest
        </Pill>
      )
    case 'error':
      return (
        <span title={view.error} className="inline-flex items-center gap-1.5">
          <Pill tone="danger">Couldn't save</Pill>
          <button type="button" onClick={onRetry} className="text-[12px] font-medium text-kumo-brand hover:underline">
            Retry
          </button>
        </span>
      )
  }
}

function Message({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-kumo-subtle">
      {children}{' '}
      <Link to="/ba-projects" className="text-kumo-brand hover:underline">
        Back to BA Projects
      </Link>
    </div>
  )
}

function ProjectLayout() {
  const { projectId } = Route.useParams()
  const studio = useProcessStudio()
  const { view, loadError, applyOps, retry } = useProcessProject(studio.ui, projectId)
  const toasts = useKumoToastManager()
  const toastsRef = useRef(toasts)
  useEffect(() => {
    toastsRef.current = toasts
  })
  useDocumentTitle(view ? view.snapshot.name : 'BA Projects')

  const conflict = view?.saveStatus === 'conflict' ? view.error : undefined
  useEffect(() => {
    if (conflict) toastsRef.current.add({ title: `Your last change was not saved: ${conflict}`, variant: 'error' })
  }, [conflict])

  if (studio.status === 'error') return <Message>Process Studio is unavailable: {studio.error}</Message>
  if (loadError) return <Message>This project could not be opened. It may not exist, or you may not have access.</Message>
  if (!view) return <p className="py-16 text-center text-sm text-kumo-subtle">Loading project…</p>

  const { snapshot } = view
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-kumo-line px-5 py-3">
        <div className="min-w-0">
          <p className="text-[12px] text-kumo-subtle">
            <Link to="/ba-projects" className="hover:text-kumo-default">BA Projects</Link>
          </p>
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[18px] font-semibold text-kumo-default">{snapshot.name}</h1>
            <Pill tone={roleTone[snapshot.role]}>{snapshot.role}</Pill>
          </div>
        </div>
        <SaveStatus view={view} onRetry={retry} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main aria-label="Process map" className="min-h-[400px] min-w-0 flex-1 p-3">
          <ProcessCanvas graph={snapshot.graph} readOnly={snapshot.role === 'viewer'} onOps={applyOps} />
        </main>
        <div className="flex h-[320px] w-full shrink-0 flex-col lg:h-auto lg:w-[340px]">
          <p className="border-b border-l border-kumo-line bg-kumo-tint/60 px-3 py-1.5 text-[11px] text-kumo-subtle">
            Preview: the agent is not connected to this project yet.
          </p>
          <div className="min-h-0 flex-1">
            <AgentPanel stage="to-be" />
          </div>
        </div>
      </div>
    </div>
  )
}
