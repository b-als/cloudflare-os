import { useMemo, useState } from 'react'
import { Warning } from '@phosphor-icons/react'
import ProcessDiagram from '../ProcessDiagram'
import { useProject } from '../ProjectContext'
import type { Sipoc, WasteType } from '../prototype'
import { Card, formatGbp, Pill } from '../ui'
import StageFrame from './StageFrame'

const SIPOC_COLUMNS: Array<{ key: keyof Sipoc; label: string }> = [
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'inputs', label: 'Inputs' },
  { key: 'process', label: 'Process' },
  { key: 'outputs', label: 'Outputs' },
  { key: 'customers', label: 'Customers' },
]

const wasteLabel: Record<WasteType, string> = {
  waiting: 'Waiting',
  rework: 'Rework',
  handoff: 'Hand-off',
  overprocessing: 'Over-processing',
  defects: 'Defects',
  motion: 'Motion',
}

/** Stage 3: SIPOC scope, as-is swimlane model and costed pain points (Lean waste). */
export default function AsIsStage() {
  const { project, persistence } = useProject()
  const [selectedPain, setSelectedPain] = useState<string | null>(null)
  const totalCost = project.painPoints.reduce((sum, p) => sum + p.annualCost, 0)
  const highlight = useMemo(() => {
    const pain = project.painPoints.find((p) => p.id === selectedPain)
    return pain ? new Set([pain.nodeId]) : undefined
  }, [project.painPoints, selectedPain])

  return (
    <StageFrame stage="as-is">
      <Card eyebrow="SIPOC" title={project.summary.processName}>
        <div className="grid grid-cols-5 gap-2">
          {SIPOC_COLUMNS.map((column) => (
            <div key={column.key} className="rounded-lg bg-kumo-tint/60 p-2">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-kumo-brand">{column.label}</p>
              <ol className="space-y-1">
                {project.sipoc[column.key].map((item, index) => (
                  <li key={`${column.key}-${index}`} className="rounded-md bg-kumo-base px-2 py-1 text-[11.5px] leading-[15px] text-kumo-default">
                    {column.key === 'process' && <span className="mr-1 text-kumo-inactive">{index + 1}.</span>}
                    {item}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Card>

      {persistence === 'demo' && (
        <Card
          eyebrow="As-is model · BPMN 2.0"
          title="How the process runs today"
          actions={<Pill tone="danger">{formatGbp(totalCost)} / year in measured waste</Pill>}
        >
          <ProcessDiagram model={project.asIs} painPoints={project.painPoints} highlightNodeIds={highlight} height={520} />
          <p className="mt-2 text-[11.5px] text-kumo-subtle">
            Dashed amber flows are rework and exception paths. Red badges show the measured annual cost of each pain point.
          </p>
        </Card>
      )}

      <Card
        eyebrow="Pain points"
        title="Where value is lost"
        actions={<Pill tone={totalCost > 0 ? 'danger' : 'neutral'}>{totalCost > 0 ? `${formatGbp(totalCost)} / year in measured waste` : 'Cost not recorded'}</Pill>}
      >
        <ul className="divide-y divide-kumo-line">
          {project.painPoints
            .toSorted((a, b) => b.annualCost - a.annualCost)
            .map((pain) => {
              const measure = project.framing.measures.find((m) => m.id === pain.measureId)
              const selected = pain.id === selectedPain
              return (
                <li key={pain.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedPain(selected ? null : pain.id)}
                    className={`flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${
                      selected ? 'bg-kumo-brand/10' : 'hover:bg-kumo-tint'
                    }`}
                  >
                    <Warning size={16} weight="fill" className="mt-0.5 shrink-0 text-rose-500" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-[12.5px] font-medium text-kumo-default">
                          {pain.id} · {pain.title}
                        </p>
                        <Pill tone="warning">{wasteLabel[pain.wasteType]}</Pill>
                        {measure && <Pill tone="brand">hurts {measure.id} {measure.name}</Pill>}
                      </div>
                      <p className="mt-0.5 text-[12px] text-kumo-subtle">{pain.evidence}</p>
                    </div>
                    <span className="shrink-0 text-[13px] font-semibold text-kumo-default">{pain.annualCost > 0 ? formatGbp(pain.annualCost) : 'Not costed'}</span>
                  </button>
                </li>
              )
            })}
        </ul>
      </Card>
    </StageFrame>
  )
}
