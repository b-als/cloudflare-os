import { Check, TreeStructure, WarningCircle, X } from '@phosphor-icons/react'
import { useProject } from '../ProjectContext'
import type { Outcome } from '../prototype'
import { Card, formatMeasure, Pill, stakeholderName } from '../ui'
import StageFrame from './StageFrame'

const SMART_KEYS: Array<{ key: keyof Outcome['smart']; letter: string; label: string }> = [
  { key: 'specific', letter: 'S', label: 'Specific' },
  { key: 'measurable', letter: 'M', label: 'Measurable' },
  { key: 'achievable', letter: 'A', label: 'Achievable' },
  { key: 'relevant', letter: 'R', label: 'Relevant' },
  { key: 'timeBound', letter: 'T', label: 'Time-bound' },
]

function BulletList({ items, tone }: { items: string[]; tone: 'in' | 'out' | 'plain' }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item} className="flex gap-1.5 text-[12.5px] leading-[18px] text-kumo-default">
          {tone === 'in' ? (
            <Check size={13} className="mt-0.5 shrink-0 text-kumo-success" />
          ) : tone === 'out' ? (
            <X size={13} className="mt-0.5 shrink-0 text-kumo-danger" />
          ) : (
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-kumo-subtle" />
          )}
          {item}
        </li>
      ))}
    </ul>
  )
}

/** Stage 1: problem, SMART outcomes with baseline/target measures, benefit hypothesis and scope. */
export default function OutcomesStage() {
  const { project, trace } = useProject()
  const { framing } = project
  const weakOutcomes = framing.outcomes.filter((o) => SMART_KEYS.some(({ key }) => !o.smart[key]))

  return (
    <StageFrame stage="outcomes">
      <div className="grid gap-4 md:grid-cols-2">
        <Card eyebrow="Problem statement" title="Why this matters now">
          <p className="text-[13px] leading-[19px] text-kumo-default">{framing.problemStatement}</p>
        </Card>
        <Card eyebrow="Benefit hypothesis" title="If we…, then…">
          <p className="text-[13px] leading-[19px] text-kumo-default">{framing.benefitHypothesis}</p>
        </Card>
      </div>

      {weakOutcomes.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-kumo-warning/40 bg-kumo-warning-tint px-3 py-2.5 text-[12.5px] text-kumo-warning">
          <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
          <p>
            <span className="font-semibold">Agent challenge:</span>{' '}
            {weakOutcomes.map((o) => o.id).join(', ')} {weakOutcomes.length === 1 ? 'does' : 'do'} not pass the SMART check yet. The stage
            cannot close until every outcome is specific, measurable, achievable, relevant and time-bound.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {framing.outcomes.map((outcome) => {
          const measures = framing.measures.filter((m) => m.outcomeId === outcome.id)
          return (
            <Card
              key={outcome.id}
              eyebrow={`${outcome.id} · owner ${stakeholderName(project, outcome.ownerStakeholderId)}`}
              title={outcome.title}
              actions={
                <button
                  type="button"
                  onClick={() => trace({ type: 'outcome', id: outcome.id })}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-kumo-line px-2 text-[11.5px] text-kumo-default hover:bg-kumo-tint"
                >
                  <TreeStructure size={12} /> Trace
                </button>
              }
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="max-w-[640px] text-[13px] leading-[19px] text-kumo-default">{outcome.statement}</p>
                <div className="flex gap-1" aria-label="SMART check">
                  {SMART_KEYS.map(({ key, letter, label }) => (
                    <span
                      key={key}
                      title={`${label}: ${outcome.smart[key] ? 'pass' : 'needs work'}`}
                      className={`flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold ${
                        outcome.smart[key] ? 'bg-kumo-success-tint text-kumo-success' : 'bg-kumo-danger-tint text-kumo-danger'
                      }`}
                    >
                      {letter}
                    </span>
                  ))}
                </div>
              </div>
              <table className="mt-3 w-full text-left text-[12px]">
                <thead className="text-[11px] uppercase tracking-wide text-kumo-inactive">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Measure</th>
                    <th className="py-1 pr-3 font-medium">Baseline</th>
                    <th className="py-1 pr-3 font-medium">Target</th>
                    <th className="py-1 pr-3 font-medium">Source</th>
                    <th className="py-1 font-medium">Cadence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-kumo-line">
                  {measures.map((m) => (
                    <tr key={m.id}>
                      <td className="py-1.5 pr-3 text-kumo-default">
                        <span className="font-semibold">{m.id}</span> {m.name}
                      </td>
                      <td className="py-1.5 pr-3 text-kumo-subtle">{formatMeasure(m.baseline, m)}</td>
                      <td className="py-1.5 pr-3">
                        <Pill tone="brand">
                          {m.direction === 'decrease' ? '↓' : '↑'} {formatMeasure(m.target, m)}
                        </Pill>
                      </td>
                      <td className="py-1.5 pr-3 text-kumo-subtle">{m.source}</td>
                      <td className="py-1.5 text-kumo-subtle">{m.cadence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card eyebrow="Scope" title="In scope">
          <BulletList items={framing.scopeIn} tone="in" />
        </Card>
        <Card eyebrow="Scope" title="Out of scope">
          <BulletList items={framing.scopeOut} tone="out" />
        </Card>
        <Card eyebrow="Assumptions" title="To be validated">
          <BulletList items={framing.assumptions} tone="plain" />
        </Card>
        <Card eyebrow="Constraints" title="Non-negotiable">
          <BulletList items={framing.constraints} tone="plain" />
        </Card>
      </div>
    </StageFrame>
  )
}
