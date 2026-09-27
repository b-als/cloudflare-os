import { useMemo, useState } from 'react'
import { DemoDataBadge, Card, Pill, stakeholderName, priorityTone, priorityLabel } from '../ui'
import { useProject } from '../ProjectContext'
import StageFrame from './StageFrame'
import type { Tone } from '../ui'

const conflictTone = { open: 'danger', inReview: 'warning', resolved: 'success', deferred: 'neutral', rejected: 'neutral' } as const satisfies Record<string, Tone>
const decisionTone = { proposed: 'warning', approved: 'success', rejected: 'danger', superseded: 'neutral' } as const satisfies Record<string, Tone>

function impactClass(value: number): string {
  if (value > 1) return 'bg-kumo-success-tint text-kumo-success ring-1 ring-kumo-success/40'
  if (value > 0) return 'bg-kumo-success-tint text-kumo-success'
  if (value < -1) return 'bg-kumo-danger-tint text-kumo-danger ring-1 ring-kumo-danger/40'
  if (value < 0) return 'bg-kumo-danger-tint text-kumo-danger'
  return 'bg-kumo-tint text-kumo-subtle'
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

/** Weighted trade-off analysis and conflict register for the demo project. */
export default function TradeoffsStage() {
  const { project, trace } = useProject()
  const outcomes = project.framing.outcomes
  const [weights, setWeights] = useState<Record<string, number>>(() => Object.fromEntries(outcomes.map((outcome) => [outcome.id, 1])))
  const impact = useMemo(
    () => new Map(project.tradeoffImpacts.map((item) => [`${item.optionId}:${item.outcomeId}`, item])),
    [project.tradeoffImpacts],
  )

  const totals = useMemo(
    () =>
      new Map(
        project.bundle.tradeoffRegister.options.map((option) => [
          option.id,
          outcomes.reduce((total, outcome) => total + (impact.get(`${option.id}:${outcome.id}`)?.impact ?? 0) * (weights[outcome.id] ?? 1), 0),
        ]),
      ),
    [impact, outcomes, project.bundle.tradeoffRegister.options, weights],
  )

  return (
    <StageFrame stage="tradeoffs" actions={<DemoDataBadge />}>
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.4fr]">
        <Card title="Conflict register" eyebrow="Resolvable tensions">
          <div className="space-y-3">
            {project.bundle.conflictRegister.conflicts.map((conflict) => (
              <article key={conflict.id} className="rounded-lg border border-kumo-line bg-kumo-elevated p-3">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-[13px] font-semibold leading-5 text-kumo-default">{conflict.summary}</h4>
                  <Pill tone={conflictTone[conflict.decision.status]}>{conflict.decision.status}</Pill>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[12px] text-kumo-subtle">
                  <Pill>{conflict.impact}</Pill>
                  {conflict.stakeholderIds.map((id) => (
                    <span key={id}>{stakeholderName(project, id)}</span>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-kumo-subtle">
                  <span>Requirements:</span>
                  {conflict.requirementIds.map((id) => (
                    <button key={id} type="button" onClick={() => trace({ type: 'requirement', id })} className="text-kumo-brand hover:underline">
                      {id}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[12px] text-kumo-subtle">Owner: {stakeholderName(project, conflict.resolutionOwnerStakeholderId)}</p>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Outcome-weighted options matrix" eyebrow="Preferred option highlighted">
          <div className="mb-3 grid gap-2 md:grid-cols-3">
            {outcomes.map((outcome) => (
              <div key={outcome.id} className="rounded-lg bg-kumo-tint p-2">
                <button type="button" onClick={() => trace({ type: 'outcome', id: outcome.id })} className="text-left text-[12px] font-medium text-kumo-brand hover:underline">
                  {outcome.title}
                </button>
                <div className="mt-1 flex gap-1">
                  {[1, 2, 3].map((weight) => (
                    <button
                      key={weight}
                      type="button"
                      onClick={() => setWeights((current) => ({ ...current, [outcome.id]: weight }))}
                      className={`rounded-md px-2 py-0.5 text-[11px] ${weights[outcome.id] === weight ? 'bg-kumo-brand text-white' : 'bg-kumo-base text-kumo-subtle'}`}
                    >
                      ×{weight}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-[12px]">
              <thead className="text-kumo-inactive">
                <tr>
                  <th className="border-b border-kumo-line py-2 pr-3 font-medium">Option</th>
                  {outcomes.map((outcome) => (
                    <th key={outcome.id} className="border-b border-kumo-line px-2 py-2 font-medium">{outcome.id}</th>
                  ))}
                  <th className="border-b border-kumo-line px-2 py-2 font-medium">Weighted total</th>
                  <th className="border-b border-kumo-line py-2 pl-2 font-medium">Classic scores</th>
                </tr>
              </thead>
              <tbody>
                {project.bundle.tradeoffRegister.options.map((option) => {
                  const preferred = option.id === project.bundle.tradeoffRegister.preferredOptionId
                  return (
                    <tr key={option.id} className={preferred ? 'bg-kumo-brand/10' : ''}>
                      <td className="border-b border-kumo-line/70 py-3 pr-3 align-top">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-kumo-default">{option.title}</span>
                          {preferred && <Pill tone="brand">Preferred</Pill>}
                        </div>
                        <p className="mt-1 text-kumo-subtle">{option.summary}</p>
                      </td>
                      {outcomes.map((outcome) => {
                        const item = impact.get(`${option.id}:${outcome.id}`)
                        const value = item?.impact ?? 0
                        return (
                          <td key={outcome.id} className="border-b border-kumo-line/70 px-2 py-3 align-top">
                            <span title={item?.rationale} className={`inline-flex h-7 min-w-9 items-center justify-center rounded-md font-semibold ${impactClass(value)}`}>
                              {signed(value)}
                            </span>
                          </td>
                        )
                      })}
                      <td className="border-b border-kumo-line/70 px-2 py-3 text-[14px] font-semibold text-kumo-default">{signed(totals.get(option.id) ?? 0)}</td>
                      <td className="border-b border-kumo-line/70 py-3 pl-2 text-kumo-subtle">
                        UV {option.scores.userValue} · Effort {option.scores.deliveryEffort} · Risk {option.scores.operationalRisk} · Compliance {option.scores.complianceFit}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="Decision log" eyebrow="Traceable rationale">
        <div className="grid gap-3 md:grid-cols-3">
          {project.bundle.requirements.decisionLog.map((decision) => (
            <article key={decision.id} className="rounded-lg border border-kumo-line bg-kumo-elevated p-3">
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-[13px] font-semibold text-kumo-default">{decision.summary}</h4>
                <Pill tone={decisionTone[decision.status]}>{decision.status}</Pill>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-kumo-subtle">{decision.rationale}</p>
              <p className="mt-2 text-[12px] text-kumo-subtle">Owner: {stakeholderName(project, decision.ownerStakeholderId)}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {decision.requirementIds.map((id) => (
                  <button key={id} type="button" onClick={() => trace({ type: 'requirement', id })}>
                    <Pill tone={priorityTone[project.bundle.requirements.requirements.find((requirement) => requirement.id === id)?.priority ?? 'could']}>
                      {id} · {priorityLabel[project.bundle.requirements.requirements.find((requirement) => requirement.id === id)?.priority ?? 'could']}
                    </Pill>
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </Card>
    </StageFrame>
  )
}
