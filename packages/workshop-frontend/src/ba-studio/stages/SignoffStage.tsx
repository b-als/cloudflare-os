import { useMemo, useState } from 'react'
import { Card, DemoDataBadge, Pill, priorityLabel, priorityTone, stakeholderName } from '../ui'
import { useProject } from '../ProjectContext'
import type { BaselineChange } from '../prototype'
import type { Tone } from '../ui'
import StageFrame from './StageFrame'

const approverTone = { approved: 'success', approvedWithConditions: 'warning', rejected: 'danger' } as const satisfies Record<string, Tone>
const baselineTone = { draft: 'neutral', inReview: 'warning', baselined: 'success', superseded: 'neutral' } as const satisfies Record<string, Tone>
const changeTone = { added: 'success', changed: 'warning', removed: 'danger' } as const satisfies Record<string, Tone>

function groupChanges(changes: BaselineChange[]): Record<BaselineChange['kind'], BaselineChange[]> {
  return {
    added: changes.filter((change) => change.kind === 'added'),
    changed: changes.filter((change) => change.kind === 'changed'),
    removed: changes.filter((change) => change.kind === 'removed'),
  }
}

/** Baseline approval pack, version history and demo sign-off action. */
export default function SignoffStage() {
  const { project, persistence } = useProject()
  const versions = project.versions
  const [fromVersion, setFromVersion] = useState(versions[0]?.version ?? '')
  const [toVersion, setToVersion] = useState(versions.at(-1)?.version ?? '')
  const [localApproval, setLocalApproval] = useState(false)

  const requirementCounts = project.bundle.requirements.requirements.reduce<Record<string, number>>((counts, requirement) => {
    counts[requirement.priority] = (counts[requirement.priority] ?? 0) + 1
    return counts
  }, {})
  const processStepCount = project.toBe.nodes.filter((node) => node.type !== 'startEvent' && node.type !== 'endEvent').length
  const openConflicts = project.bundle.conflictRegister.conflicts.filter((conflict) => !['resolved', 'rejected'].includes(conflict.decision.status)).length
  const openFindings = project.findings.filter((finding) => !finding.resolved).length

  const diff = useMemo(() => {
    const fromIndex = versions.findIndex((version) => version.version === fromVersion)
    const toIndex = versions.findIndex((version) => version.version === toVersion)
    const start = Math.min(fromIndex, toIndex) + 1
    const end = Math.max(fromIndex, toIndex) + 1
    return groupChanges(versions.slice(start, end).flatMap((version) => version.changes))
  }, [fromVersion, toVersion, versions])

  return (
    <StageFrame stage="signoff" actions={<DemoDataBadge />}>
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card title="Approvals pack" eyebrow={`Baseline ${project.bundle.signoffPacket.baselineVersion}`}>
          <div className="space-y-3">
            {project.bundle.signoffPacket.approvers.map((approver) => (
              <article key={approver.stakeholderId} className="rounded-lg border border-kumo-line bg-kumo-elevated p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-[13px] font-semibold text-kumo-default">{stakeholderName(project, approver.stakeholderId)}</h4>
                    <p className="text-[12px] text-kumo-subtle">{approver.role}</p>
                  </div>
                  <Pill tone={approverTone[approver.decision]}>{approver.decision}</Pill>
                </div>
                {approver.note && <p className="mt-2 text-[12px] leading-5 text-kumo-subtle">{approver.note}</p>}
              </article>
            ))}
            {persistence === 'demo' && localApproval && (
              <article className="rounded-lg border border-kumo-success/40 bg-kumo-success-tint p-3 text-[12px] text-kumo-success">
                Current user approved baseline 1.0 locally for the prototype.
              </article>
            )}
          </div>
        </Card>

        <Card
          title="What is being approved"
          eyebrow="Pack summary"
          actions={persistence === 'demo' ? (
            <button type="button" onClick={() => setLocalApproval(true)} className="rounded-lg bg-kumo-brand px-3 py-1.5 text-[12px] font-medium text-white">
              Approve baseline 1.0
            </button>
          ) : undefined}
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg bg-kumo-tint p-3"><p className="text-[11px] text-kumo-inactive">Outcomes</p><p className="text-[20px] font-semibold text-kumo-default">{project.framing.outcomes.length}</p></div>
            {(['must', 'should', 'could', 'wont'] as const).map((priority) => (
              <div key={priority} className="rounded-lg bg-kumo-tint p-3">
                <p className="text-[11px] text-kumo-inactive">{priorityLabel[priority]}</p>
                <p className="text-[20px] font-semibold text-kumo-default">{requirementCounts[priority] ?? 0}</p>
                <Pill tone={priorityTone[priority]}>{priority}</Pill>
              </div>
            ))}
            <div className="rounded-lg bg-kumo-tint p-3"><p className="text-[11px] text-kumo-inactive">Process steps</p><p className="text-[20px] font-semibold text-kumo-default">{processStepCount}</p></div>
            <div className="rounded-lg bg-kumo-tint p-3"><p className="text-[11px] text-kumo-inactive">Decisions</p><p className="text-[20px] font-semibold text-kumo-default">{project.bundle.requirements.decisionLog.length}</p></div>
            <div className="rounded-lg bg-kumo-tint p-3"><p className="text-[11px] text-kumo-inactive">Open conflicts</p><p className="text-[20px] font-semibold text-kumo-default">{openConflicts}</p></div>
            <div className="rounded-lg bg-kumo-tint p-3"><p className="text-[11px] text-kumo-inactive">Open findings</p><p className="text-[20px] font-semibold text-kumo-default">{openFindings}</p></div>
          </div>
        </Card>
      </div>

      <Card title="Versioned baseline timeline" eyebrow="Change-controlled history">
        {versions.length === 0 && <p className="text-[12px] text-kumo-subtle">No baseline captured yet. Capture one from the review controls below.</p>}
        <div className="grid gap-3 md:grid-cols-3">
          {versions.map((version) => (
            <article key={version.version} className="rounded-lg border border-kumo-line bg-kumo-elevated p-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[14px] font-semibold text-kumo-default">v{version.version}</h4>
                <Pill tone={baselineTone[version.status]}>{version.status}</Pill>
              </div>
              <p className="mt-1 text-[12px] text-kumo-subtle">{new Date(version.createdAt).toLocaleDateString()} · {version.author}</p>
              <p className="mt-2 text-[12px] leading-5 text-kumo-default">{version.summary}</p>
            </article>
          ))}
        </div>
      </Card>

      <Card
        title="Version diff"
        eyebrow="Cumulative changes"
        actions={
          <div className="flex items-center gap-2 text-[12px]">
            <select value={fromVersion} onChange={(event) => setFromVersion(event.target.value)} className="rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-kumo-default">
              {versions.map((version) => <option key={version.version}>{version.version}</option>)}
            </select>
            <span className="text-kumo-inactive">→</span>
            <select value={toVersion} onChange={(event) => setToVersion(event.target.value)} className="rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-kumo-default">
              {versions.map((version) => <option key={version.version}>{version.version}</option>)}
            </select>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          {(['added', 'changed', 'removed'] as const).map((kind) => (
            <section key={kind} className="rounded-lg bg-kumo-tint p-3">
              <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-kumo-default"><Pill tone={changeTone[kind]}>{kind}</Pill></h4>
              <div className="space-y-2">
                {diff[kind].map((change) => (
                  <div key={`${change.kind}-${change.artifact}-${change.ref}-${change.summary}`} className="rounded-md bg-kumo-base p-2 text-[12px]">
                    <p className="font-medium text-kumo-default">{change.artifact} · {change.ref}</p>
                    <p className="text-kumo-subtle">{change.summary}</p>
                  </div>
                ))}
                {diff[kind].length === 0 && <p className="text-[12px] text-kumo-inactive">No {kind} items in this range.</p>}
              </div>
            </section>
          ))}
        </div>
      </Card>
    </StageFrame>
  )
}
