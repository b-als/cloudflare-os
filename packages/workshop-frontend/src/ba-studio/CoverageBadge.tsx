import { useMemo } from 'react'
import { CheckCircle, Circle, ClipboardText } from '@phosphor-icons/react'
import { Popover } from '@cloudflare/kumo'
import { computeCoverage } from '@gadgets/gatekeeper-process/coverage'
import type { ProcessGraph } from '@gadgets/gatekeeper-process/types'

export type CoverageBadgeProps = { graph: ProcessGraph }

/** Compact header indicator for the lightweight BA elicitation checklist, computed from the graph. */
export default function CoverageBadge({ graph }: CoverageBadgeProps) {
  const items = useMemo(() => computeCoverage(graph), [graph])
  const doneCount = items.filter((item) => item.done).length
  const complete = doneCount === items.length

  return (
    <Popover>
      <Popover.Trigger
        render={
          <button
            type="button"
            aria-label={`Elicitation coverage: ${doneCount} of ${items.length} covered`}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-kumo-line px-2.5 text-[12px] font-medium text-kumo-default hover:bg-kumo-tint"
          >
            <ClipboardText size={13} />
            Coverage
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ${
                complete ? 'bg-kumo-success-tint text-kumo-success' : 'bg-kumo-tint text-kumo-subtle'
              }`}
            >
              {doneCount}/{items.length}
            </span>
          </button>
        }
      />
      <Popover.Content
        align="end"
        sideOffset={6}
        className="!z-[1100] !w-[300px] !min-w-0 rounded-2xl bg-kumo-base p-3 shadow-lg shadow-kumo-tip-shadow"
      >
        <Popover.Title className="mb-2 block text-[11px] font-medium uppercase tracking-[0.06em] text-kumo-inactive">
          Elicitation coverage
        </Popover.Title>
        <ul className="flex flex-col gap-2.5">
          {items.map((item) => (
            <li key={item.key} className="flex items-start gap-2">
              {item.done ? (
                <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-kumo-success" />
              ) : (
                <Circle size={16} className="mt-0.5 shrink-0 text-kumo-inactive" />
              )}
              <div className="min-w-0">
                <p className={`text-[12.5px] leading-4 ${item.done ? 'text-kumo-default' : 'text-kumo-subtle'}`}>
                  {item.label}
                </p>
                {!item.done && <p className="mt-0.5 text-[11.5px] leading-4 text-kumo-inactive">{item.hint}</p>}
              </div>
            </li>
          ))}
        </ul>
      </Popover.Content>
    </Popover>
  )
}
