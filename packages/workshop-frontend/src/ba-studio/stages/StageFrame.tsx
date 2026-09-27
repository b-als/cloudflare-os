import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight } from '@phosphor-icons/react'
import { useProject } from '../ProjectContext'
import type { StageId } from '../prototype'
import { STAGES, stageIndex } from '../stages'

/** Common frame for a stage screen: title, method, description and previous/next navigation. */
export default function StageFrame({ stage, actions, children }: { stage: StageId; actions?: ReactNode; children: ReactNode }) {
  const { project } = useProject()
  const index = stageIndex(stage)
  const def = STAGES[index]
  const previous = STAGES[index - 1]
  const next = STAGES[index + 1]
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-4 px-5 py-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-kumo-inactive">
            Stage {index + 1} · {def.method}
          </p>
          <h2 className="text-[20px] font-semibold tracking-tight text-kumo-default">{def.label}</h2>
          <p className="text-[13px] text-kumo-subtle">{def.description}</p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
      <footer className="flex items-center justify-between border-t border-kumo-line pt-4">
        {previous ? (
          <Link
            to="/ba-projects/$projectId/$stage"
            params={{ projectId: project.summary.id, stage: previous.id }}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-kumo-subtle hover:text-kumo-default"
          >
            <ArrowLeft size={13} /> {previous.label}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link
            to="/ba-projects/$projectId/$stage"
            params={{ projectId: project.summary.id, stage: next.id }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-kumo-brand px-3 text-[12.5px] font-medium text-white hover:bg-kumo-brand-hover"
          >
            Next: {next.label} <ArrowRight size={13} />
          </Link>
        )}
      </footer>
    </div>
  )
}
