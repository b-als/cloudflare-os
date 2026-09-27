import { useState } from 'react'
import { createFileRoute, Link, Outlet, useParams } from '@tanstack/react-router'
import { CaretRight, CheckCircle, Circle, Robot, TreeStructure, WarningCircle } from '@phosphor-icons/react'
import { useDocumentTitle } from '../useDocumentTitle'
import AgentPanel from '../ba-studio/AgentPanel'
import TraceabilityDrawer from '../ba-studio/TraceabilityDrawer'
import { ProjectContext, type TraceFocus } from '../ba-studio/ProjectContext'
import { getDemoProject } from '../ba-studio/demoProject'
import { isStageId, STAGES } from '../ba-studio/stages'
import type { BaPrototypeProject, StageId, StageStatus } from '../ba-studio/prototype'
import { DemoDataBadge } from '../ba-studio/ui'

/**
 * Shared layout for one BA Studio project: header, stage progress bar, the stage screen
 * (`<Outlet />`), the always-open BA agent panel and the traceability drawer.
 */
export const Route = createFileRoute('/ba-projects/$projectId')({
  component: ProjectLayout,
})

function StatusIcon({ status }: { status: StageStatus }) {
  if (status === 'done') return <CheckCircle size={14} weight="fill" className="text-kumo-success" />
  if (status === 'attention') return <WarningCircle size={14} weight="fill" className="text-kumo-warning" />
  if (status === 'active') return <Circle size={14} weight="duotone" className="text-kumo-brand" />
  return <Circle size={14} className="text-kumo-inactive" />
}

function StageProgress({ project, current }: { project: BaPrototypeProject; current: StageId | undefined }) {
  return (
    <nav aria-label="Project stages" className="flex items-center gap-0.5 overflow-x-auto border-b border-kumo-line px-4 py-2">
      {STAGES.map((stage, index) => {
        const status = project.stageStatus[stage.id]
        const selected = stage.id === current
        return (
          <div key={stage.id} className="flex shrink-0 items-center">
            <Link
              to="/ba-projects/$projectId/$stage"
              params={{ projectId: project.summary.id, stage: stage.id }}
              title={`${stage.label} — ${stage.method}`}
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] transition-colors ${
                selected ? 'bg-kumo-fill font-medium text-kumo-strong' : 'text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default'
              }`}
            >
              <StatusIcon status={status} />
              <span className="text-kumo-inactive">{index + 1}</span>
              {stage.label}
              {stage.future && <span className="rounded bg-kumo-tint px-1 text-[9.5px] uppercase text-kumo-inactive">Future</span>}
            </Link>
            {index < STAGES.length - 1 && <CaretRight size={10} className="mx-0.5 text-kumo-inactive" />}
          </div>
        )
      })}
    </nav>
  )
}

function ProjectLayout() {
  const { projectId } = Route.useParams()
  const { stage } = useParams({ strict: false }) as { stage?: string }
  const project = getDemoProject(projectId)
  const currentStage = stage && isStageId(stage) ? stage : undefined
  const [traceFocus, setTraceFocus] = useState<TraceFocus | null>(null)
  const [agentOpen, setAgentOpen] = useState(true)
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

  const defaultFocus: TraceFocus = { type: 'outcome', id: project.framing.outcomes[0]?.id ?? '' }

  return (
    <ProjectContext.Provider value={{ project, trace: setTraceFocus }}>
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-kumo-line px-5 py-3">
          <div className="min-w-0">
            <p className="text-[12px] text-kumo-subtle">
              <Link to="/ba-projects" className="hover:text-kumo-default">
                BA Projects
              </Link>
              <span className="mx-1.5 text-kumo-inactive">/</span>
              {project.summary.id}
            </p>
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[18px] font-semibold tracking-tight text-kumo-default">{project.summary.processName}</h1>
              <DemoDataBadge />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTraceFocus((current) => (current ? null : defaultFocus))}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-kumo-line px-2.5 text-[12px] text-kumo-default hover:bg-kumo-tint"
            >
              <TreeStructure size={14} />
              Traceability
            </button>
            <button
              type="button"
              onClick={() => setAgentOpen((open) => !open)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] ${
                agentOpen ? 'bg-kumo-brand/15 text-kumo-brand' : 'border border-kumo-line text-kumo-default hover:bg-kumo-tint'
              }`}
            >
              <Robot size={14} />
              BA agent
            </button>
          </div>
        </header>
        <StageProgress project={project} current={currentStage} />
        <div className="relative flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-y-auto">
            <Outlet />
          </div>
          {agentOpen && currentStage && (
            <div className="w-[340px] shrink-0">
              <AgentPanel key={currentStage} stage={currentStage} />
            </div>
          )}
          {traceFocus && (
            <TraceabilityDrawer project={project} focus={traceFocus} onFocus={setTraceFocus} onClose={() => setTraceFocus(null)} />
          )}
        </div>
      </div>
    </ProjectContext.Provider>
  )
}
