import { Check } from '@phosphor-icons/react'
import { PHASES, type PhaseProgress } from './phase'

/** Where the conversation has got to. Progress only: phases are reached by talking, not clicked. */
export const PhaseIndicator = ({ progress }: { progress: PhaseProgress }) => {
  const current = PHASES.findIndex((phase) => phase.id === progress.phase)
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ol aria-label="Progress" className="flex shrink-0 items-center gap-1">
        {PHASES.map((phase, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'later'
          return (
            <li key={phase.id} aria-current={state === 'current' ? 'step' : undefined} className="flex items-center gap-1">
              {index > 0 && <span aria-hidden className={`h-px w-4 ${index <= current ? 'bg-kumo-brand' : 'bg-kumo-line'}`} />}
              <span
                className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] ${
                  state === 'current'
                    ? 'bg-kumo-info-tint font-semibold text-kumo-brand'
                    : state === 'done' ? 'text-kumo-default' : 'text-kumo-inactive'
                }`}
              >
                {state === 'done' && <Check size={11} weight="bold" aria-hidden />}
                {phase.label}
                {state === 'done' && <span className="sr-only">, done</span>}
              </span>
            </li>
          )
        })}
      </ol>
      {progress.next && (
        <p className="hidden min-w-0 truncate text-[12px] text-kumo-subtle lg:block" aria-live="polite">
          Next: {progress.next}
        </p>
      )}
    </div>
  )
}
