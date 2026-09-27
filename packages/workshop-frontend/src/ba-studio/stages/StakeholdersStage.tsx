import { useState } from 'react'
import { Check, Plus, WarningCircle } from '@phosphor-icons/react'
import { useProject } from '../ProjectContext'
import type { StakeholderProfile } from '../prototype'
import { Card, Pill, stakeholderName, type Tone } from '../ui'
import StageFrame from './StageFrame'

const stanceTone: Record<StakeholderProfile['stance'], Tone> = {
  champion: 'success',
  supporter: 'info',
  neutral: 'neutral',
  sceptic: 'warning',
}

const stanceDot: Record<StakeholderProfile['stance'], string> = {
  champion: 'bg-kumo-success',
  supporter: 'bg-sky-500',
  neutral: 'bg-kumo-inactive',
  sceptic: 'bg-kumo-warning',
}

const QUADRANTS = [
  { label: 'Keep satisfied', className: 'left-0 top-0' },
  { label: 'Manage closely', className: 'right-0 top-0 text-right' },
  { label: 'Monitor', className: 'bottom-0 left-0' },
  { label: 'Keep informed', className: 'bottom-0 right-0 text-right' },
]

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((part) => /^[A-Z]/.test(part))
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
}

/** Stage 2: power/interest grid, stakeholder gap suggestions and a draft RACI chart. */
export default function StakeholdersStage() {
  const { project, trace } = useProject()
  const { stakeholders, stakeholderSuggestions = [], raci } = project.bundle.requirements
  const [suggestionState, setSuggestionState] = useState<Record<string, 'added' | 'dismissed'>>({})

  const raciByActivity = new Map(raci.map((row) => [row.activityId, row]))
  const humanSteps = project.toBe.nodes.filter((n) => n.type === 'userTask' || n.type === 'serviceTask')
  const missingRaci = humanSteps.filter((n) => !raciByActivity.has(n.id))

  const raciCell = (activityId: string, stakeholderId: string): string => {
    const row = raciByActivity.get(activityId)
    if (!row) return ''
    const letters = [
      row.responsible.includes(stakeholderId) ? 'R' : '',
      row.accountable === stakeholderId ? 'A' : '',
      row.consulted.includes(stakeholderId) ? 'C' : '',
      row.informed.includes(stakeholderId) ? 'I' : '',
    ]
    return letters.filter(Boolean).join('/')
  }

  return (
    <StageFrame stage="stakeholders">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card eyebrow="Power / interest grid" title="Who matters, and how to engage them">
          <div className="relative aspect-square max-h-[340px] w-full rounded-lg border border-kumo-line bg-kumo-tint/40">
            <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-kumo-line" />
            <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-kumo-line" />
            {QUADRANTS.map((q) => (
              <span key={q.label} className={`absolute m-2 text-[10.5px] font-medium uppercase tracking-wide text-kumo-inactive ${q.className}`}>
                {q.label}
              </span>
            ))}
            {project.stakeholderProfiles.map((profile) => {
              const name = stakeholderName(project, profile.stakeholderId)
              return (
                <div
                  key={profile.stakeholderId}
                  title={`${name} · influence ${profile.influence}/5 · interest ${profile.interest}/5 · ${profile.stance}`}
                  className="absolute flex -translate-x-1/2 translate-y-1/2 flex-col items-center"
                  style={{ left: `${((profile.interest - 0.5) / 5) * 100}%`, bottom: `${((profile.influence - 0.5) / 5) * 100}%` }}
                >
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold text-white shadow ${stanceDot[profile.stance]}`}>
                    {initials(name) || '?'}
                  </span>
                  <span className="mt-0.5 whitespace-nowrap text-[10px] text-kumo-default">{name.split(' ')[0]}</span>
                </div>
              )
            })}
            <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10.5px] text-kumo-inactive">Interest →</span>
            <span className="absolute -left-1 top-1/2 -translate-x-full -translate-y-1/2 -rotate-90 text-[10.5px] text-kumo-inactive">
              Influence →
            </span>
          </div>
        </Card>

        <Card eyebrow="Stakeholder register" title={`${stakeholders.length} stakeholders`}>
          <ul className="divide-y divide-kumo-line">
            {project.stakeholderProfiles.map((profile) => {
              const stakeholder = stakeholders.find((s) => s.id === profile.stakeholderId)
              return (
                <li key={profile.stakeholderId} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium text-kumo-default">{stakeholder?.name}</p>
                    <p className="text-[11.5px] text-kumo-subtle">{stakeholder?.role}</p>
                    <p className="text-[11.5px] text-kumo-inactive">{profile.engagement}</p>
                  </div>
                  <Pill tone={stanceTone[profile.stance]}>{profile.stance}</Pill>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      <Card eyebrow="Gap analysis" title="Suggested missing stakeholders">
        <p className="mb-2 text-[12px] text-kumo-subtle">
          The agent never contacts anyone. It suggests who is missing; you decide whether to bring them in.
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {stakeholderSuggestions.map((suggestion) => {
            const state = suggestionState[suggestion.id]
            return (
              <div
                key={suggestion.id}
                className={`rounded-lg border border-kumo-line p-3 ${state === 'dismissed' ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12.5px] font-medium text-kumo-default">
                    {suggestion.name ? `${suggestion.name} · ` : ''}
                    {suggestion.role}
                  </p>
                  <Pill tone="violet">{suggestion.source === 'gapAnalysis' ? 'Gap analysis' : 'From interview'}</Pill>
                </div>
                <p className="mt-1 text-[12px] leading-[17px] text-kumo-subtle">{suggestion.reason}</p>
                <div className="mt-2 flex gap-1.5">
                  {state ? (
                    <Pill tone={state === 'added' ? 'success' : 'neutral'}>
                      {state === 'added' ? (
                        <>
                          <Check size={11} weight="bold" /> Added · interview pending
                        </>
                      ) : (
                        'Dismissed'
                      )}
                    </Pill>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setSuggestionState((s) => ({ ...s, [suggestion.id]: 'added' }))}
                        className="inline-flex h-6 items-center gap-1 rounded-md bg-kumo-brand px-2 text-[11.5px] font-medium text-white hover:bg-kumo-brand-hover"
                      >
                        <Plus size={11} weight="bold" /> Add to project
                      </button>
                      <button
                        type="button"
                        onClick={() => setSuggestionState((s) => ({ ...s, [suggestion.id]: 'dismissed' }))}
                        className="inline-flex h-6 items-center rounded-md border border-kumo-line px-2 text-[11.5px] text-kumo-default hover:bg-kumo-tint"
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card eyebrow="RACI" title="Draft responsibility chart (future-state activities)">
        {missingRaci.length > 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-kumo-warning-tint px-3 py-2 text-[12px] text-kumo-warning">
            <WarningCircle size={15} weight="fill" className="mt-0.5 shrink-0" />
            <span>
              <span className="font-semibold">Agent flag:</span> {missingRaci.map((n) => `“${n.label}”`).join(', ')}{' '}
              {missingRaci.length === 1 ? 'has' : 'have'} no RACI yet. Every activity needs exactly one Accountable.
            </span>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead className="text-[11px] text-kumo-inactive">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Activity</th>
                {stakeholders.map((s) => (
                  <th key={s.id} className="px-1 py-1.5 text-center font-medium" title={s.role}>
                    {s.name.split(' ')[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-kumo-line">
              {humanSteps.map((node) => (
                <tr key={node.id}>
                  <td className="py-1.5 pr-3">
                    <button type="button" onClick={() => trace({ type: 'node', id: node.id })} className="text-left text-kumo-default hover:text-kumo-brand">
                      {node.label}
                    </button>
                  </td>
                  {stakeholders.map((s) => {
                    const cell = raciCell(node.id, s.id)
                    return (
                      <td key={s.id} className="px-1 py-1.5 text-center">
                        {cell && (
                          <span
                            className={`inline-flex min-w-[22px] justify-center rounded px-1 text-[11px] font-semibold ${
                              cell.includes('A') ? 'bg-kumo-brand/15 text-kumo-brand' : 'bg-kumo-tint text-kumo-subtle'
                            }`}
                          >
                            {cell}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </StageFrame>
  )
}
