import { useState } from 'react'
import { CaretDown, CaretRight, TreeStructure, WarningCircle } from '@phosphor-icons/react'
import { useProject } from '../ProjectContext'
import type { RequirementPriority } from '../types'
import { orphanRequirements } from '../trace'
import { Card, Pill, priorityLabel, priorityTone, stakeholderName } from '../ui'
import StageFrame from './StageFrame'

const PRIORITIES: RequirementPriority[] = ['must', 'should', 'could', 'wont']

/** Stage 4: elicited requirements with MoSCoW, acceptance criteria, sources and outcome traceability. */
export default function RequirementsStage() {
  const { project, trace } = useProject()
  const requirements = project.bundle.requirements.requirements
  const outcomes = project.framing.outcomes
  const [priorityFilter, setPriorityFilter] = useState<RequirementPriority | 'all'>('all')
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all')
  const [expanded, setExpanded] = useState<string | null>(project.bundle.viewer.selectedRequirementId)
  const orphans = orphanRequirements(project)

  const visible = requirements.filter(
    (r) =>
      (priorityFilter === 'all' || r.priority === priorityFilter) &&
      (outcomeFilter === 'all' || (project.requirementOutcomes[r.id] ?? []).includes(outcomeFilter)),
  )
  const stepCount = (reqId: string) => project.toBe.nodes.filter((n) => n.requirementIds?.includes(reqId)).length

  return (
    <StageFrame stage="requirements">
      <div className="grid grid-cols-4 gap-2">
        {PRIORITIES.map((priority) => {
          const count = requirements.filter((r) => r.priority === priority).length
          const active = priorityFilter === priority
          return (
            <button
              key={priority}
              type="button"
              onClick={() => setPriorityFilter(active ? 'all' : priority)}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                active ? 'border-kumo-brand bg-kumo-brand/10' : 'border-kumo-line bg-kumo-base hover:bg-kumo-tint'
              }`}
            >
              <p className="text-[20px] font-semibold text-kumo-default">{count}</p>
              <Pill tone={priorityTone[priority]}>{priorityLabel[priority]} have</Pill>
            </button>
          )
        })}
      </div>

      {orphans.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-kumo-warning/40 bg-kumo-warning-tint px-3 py-2.5 text-[12.5px] text-kumo-warning">
          <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
          <p>
            <span className="font-semibold">Traceability gap:</span> {orphans.map((r) => r.id).join(', ')} {orphans.length === 1 ? 'does' : 'do'} not
            advance any outcome. Link {orphans.length === 1 ? 'it' : 'them'} to an outcome or downgrade to “won’t”.
          </p>
        </div>
      )}

      <Card
        eyebrow="Requirements catalogue"
        title={`${visible.length} of ${requirements.length} requirements`}
        actions={
          <select
            value={outcomeFilter}
            onChange={(event) => setOutcomeFilter(event.target.value)}
            className="h-7 rounded-lg border border-kumo-line bg-kumo-base px-2 text-[12px] text-kumo-default"
          >
            <option value="all">All outcomes</option>
            {outcomes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.id} · {o.title}
              </option>
            ))}
          </select>
        }
      >
        <ul className="divide-y divide-kumo-line">
          {visible.map((r) => {
            const open = expanded === r.id
            const linked = project.requirementOutcomes[r.id] ?? []
            return (
              <li key={r.id} className="py-1">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : r.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-kumo-tint"
                >
                  {open ? <CaretDown size={12} className="text-kumo-subtle" /> : <CaretRight size={12} className="text-kumo-subtle" />}
                  <span className="w-11 shrink-0 text-[12px] font-semibold text-kumo-default">{r.id}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-kumo-default">{r.title}</span>
                  <span className="hidden gap-1 sm:flex">
                    {linked.length === 0 && r.priority !== 'wont' ? (
                      <Pill tone="danger">No outcome</Pill>
                    ) : (
                      linked.map((id) => (
                        <Pill key={id} tone="brand">
                          {id}
                        </Pill>
                      ))
                    )}
                  </span>
                  <Pill tone="neutral">{r.category}</Pill>
                  <Pill tone={priorityTone[r.priority]}>{priorityLabel[r.priority]}</Pill>
                </button>
                {open && (
                  <div className="ml-6 mt-1 space-y-2 rounded-lg bg-kumo-tint/50 p-3 text-[12px]">
                    <p className="leading-[18px] text-kumo-default">{r.statement}</p>
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-kumo-inactive">Acceptance criteria</p>
                      <ul className="list-disc space-y-0.5 pl-4 text-kumo-default">
                        {r.acceptanceCriteria.map((criterion) => (
                          <li key={criterion}>{criterion}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <p className="text-kumo-subtle">
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-kumo-inactive">Fit criterion</span>
                        {r.fitCriterion}
                      </p>
                      <p className="text-kumo-subtle">
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-kumo-inactive">Owner · sources</span>
                        {stakeholderName(project, r.ownerStakeholderId)} · {r.sourceStakeholderIds.map((id) => stakeholderName(project, id)).join(', ')}
                      </p>
                      <p className="text-kumo-subtle">
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-kumo-inactive">Benefit hypothesis</span>
                        {r.benefitHypothesis}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => trace({ type: 'requirement', id: r.id })}
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-kumo-line bg-kumo-base px-2 text-[11.5px] text-kumo-default hover:bg-kumo-tint"
                    >
                      <TreeStructure size={12} /> Trace {r.id}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </Card>

      <Card eyebrow="Traceability matrix" title="Requirement × outcome × future-state steps">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="text-[11px] text-kumo-inactive">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Requirement</th>
                {outcomes.map((o) => (
                  <th key={o.id} className="px-2 py-1.5 text-center font-medium" title={o.title}>
                    {o.id}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-center font-medium">Steps</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-kumo-line">
              {requirements.map((r) => {
                const linked = project.requirementOutcomes[r.id] ?? []
                const steps = stepCount(r.id)
                return (
                  <tr key={r.id} className={r.priority === 'wont' ? 'opacity-50' : ''}>
                    <td className="py-1.5 pr-3 text-kumo-default">
                      <span className="font-semibold">{r.id}</span> {r.title}
                    </td>
                    {outcomes.map((o) => (
                      <td key={o.id} className="px-2 py-1.5 text-center">
                        {linked.includes(o.id) ? <span className="inline-block h-2.5 w-2.5 rounded-full bg-kumo-brand" /> : <span className="text-kumo-inactive">·</span>}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-center">
                      <span className={steps === 0 && r.priority !== 'wont' ? 'font-semibold text-kumo-danger' : 'text-kumo-subtle'}>{steps}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </StageFrame>
  )
}
