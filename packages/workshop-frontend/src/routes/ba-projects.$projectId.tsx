import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useDocumentTitle } from '../useDocumentTitle'
import AgentPanel from '../ba-studio/AgentPanel'
import ProcessDiagram from '../ba-studio/ProcessDiagram'
import { getDemoProject } from '../ba-studio/demoProject'
import { DemoDataBadge } from '../ba-studio/ui'

/** Focused process-mapping workspace with a visual canvas and BA agent chat. */
export const Route = createFileRoute('/ba-projects/$projectId')({
  component: ProjectLayout,
})

function ProjectLayout() {
  const { projectId } = Route.useParams()
  const project = getDemoProject(projectId)
  const [processView, setProcessView] = useState<'as-is' | 'to-be'>('to-be')
  useDocumentTitle(project ? project.summary.processName : 'BA Projects')

  if (!project) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-kumo-subtle">
        This BA project has no worked data in the prototype yet.{' '}
        <Link to="/ba-projects" className="text-kumo-brand hover:underline">
          Back to BA Projects
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-kumo-line px-5 py-3">
        <div className="min-w-0">
          <p className="text-[12px] text-kumo-subtle">
            <Link to="/ba-projects" className="hover:text-kumo-default">BA Projects</Link>
            <span className="mx-1.5 text-kumo-inactive">/</span>
            {project.summary.id}
          </p>
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[18px] font-semibold text-kumo-default">{project.summary.processName}</h1>
            <DemoDataBadge />
          </div>
        </div>
        <div className="flex rounded-lg border border-kumo-line bg-kumo-base p-0.5" aria-label="Process version">
          <button
            type="button"
            onClick={() => setProcessView('as-is')}
            className={`h-8 rounded-md px-3 text-[12px] ${processView === 'as-is' ? 'bg-kumo-fill font-medium text-kumo-strong' : 'text-kumo-subtle hover:text-kumo-default'}`}
          >
            Current state
          </button>
          <button
            type="button"
            onClick={() => setProcessView('to-be')}
            className={`h-8 rounded-md px-3 text-[12px] ${processView === 'to-be' ? 'bg-kumo-fill font-medium text-kumo-strong' : 'text-kumo-subtle hover:text-kumo-default'}`}
          >
            Future state
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main aria-label="Process map" className="min-h-[400px] min-w-0 flex-1 p-3">
          <ProcessDiagram
            model={processView === 'as-is' ? project.asIs : project.toBe}
            painPoints={processView === 'as-is' ? project.painPoints : []}
            editable
            height="100%"
          />
        </main>
        <div className="h-[320px] w-full shrink-0 lg:h-auto lg:w-[340px]">
          <AgentPanel key={processView} stage={processView} />
        </div>
      </div>
    </div>
  )
}
