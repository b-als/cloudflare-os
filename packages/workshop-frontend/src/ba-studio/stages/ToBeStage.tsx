import { useMemo, useState } from 'react'
import { Columns, TreeStructure } from '@phosphor-icons/react'
import ProcessDiagram from '../ProcessDiagram'
import { useProject } from '../ProjectContext'
import type { ProcessModel } from '../prototype'
import { Card, Pill } from '../ui'
import StageFrame from './StageFrame'

function modelStats(model: ProcessModel) {
  const lane = new Map(model.nodes.map((n) => [n.id, n.laneId]))
  const activities = model.nodes.filter((n) => n.type.endsWith('Task'))
  return {
    activities: activities.length,
    manual: activities.filter((n) => n.type !== 'serviceTask').length,
    handoffs: model.edges.filter((e) => lane.get(e.source) !== lane.get(e.target)).length,
    slaHours: activities.reduce((sum, n) => sum + (n.slaHours ?? 0), 0),
    exceptions: model.edges.filter((e) => e.isException).length,
  }
}

const STAT_LABELS: Array<{ key: keyof ReturnType<typeof modelStats>; label: string; better: 'lower' | 'higher' }> = [
  { key: 'activities', label: 'Activities', better: 'lower' },
  { key: 'manual', label: 'Manual activities', better: 'lower' },
  { key: 'handoffs', label: 'Lane hand-offs', better: 'lower' },
  { key: 'slaHours', label: 'Total SLA (h)', better: 'lower' },
  { key: 'exceptions', label: 'Modelled exception flows', better: 'higher' },
]

/** Stage 5: BPMN future-state editor, DMN decision tables, exceptions, SLAs and as-is comparison. */
export default function ToBeStage() {
  const { project, trace, persistence } = useProject()
  const [compare, setCompare] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    project.toBe.nodes.some((node) => node.id === 't-risk') ? 't-risk' : null,
  )
  const selected = project.toBe.nodes.find((n) => n.id === selectedNodeId) ?? null
  const selectedTable = project.decisionTables.find((t) => t.id === selected?.decisionTableId)
  const highlight = useMemo(() => (selectedNodeId ? new Set([selectedNodeId]) : undefined), [selectedNodeId])
  const asIsStats = modelStats(project.asIs)
  const toBeStats = modelStats(project.toBe)
  const removedPain = project.painPoints.filter((p) => !project.toBe.nodes.some((n) => n.id === p.nodeId))

  return (
    <StageFrame
      stage="to-be"
      actions={
        <button
          type="button"
          onClick={() => setCompare((value) => !value)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] ${
            compare ? 'bg-kumo-brand/15 text-kumo-brand' : 'border border-kumo-line text-kumo-default hover:bg-kumo-tint'
          }`}
        >
          <Columns size={14} /> Compare with as-is
        </button>
      }
    >
      {compare ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card eyebrow="As-is" title="Today">
            <ProcessDiagram model={project.asIs} painPoints={project.painPoints} height={380} />
          </Card>
          <Card eyebrow="To-be" title="Future state">
            <ProcessDiagram model={project.toBe} painPoints={[]} height={380} />
          </Card>
        </div>
      ) : persistence === 'live' ? (
        <Card eyebrow="Future-state model · BPMN 2.0" title="Select a step to inspect it. Edit the map on the canvas above.">
          <ProcessDiagram
            model={project.toBe}
            painPoints={[]}
            highlightNodeIds={highlight}
            onNodeClick={setSelectedNodeId}
            height={360}
          />
        </Card>
      ) : (
        <Card
          eyebrow="Future-state model · BPMN 2.0"
          title="Drag to rearrange, drag between handles to add a flow"
          actions={<Pill tone="neutral">Edits are local in the prototype</Pill>}
        >
          <ProcessDiagram
            model={project.toBe}
            painPoints={[]}
            highlightNodeIds={highlight}
            onNodeClick={setSelectedNodeId}
            editable
            height={560}
          />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card eyebrow="Inspector" title={selected ? selected.label : 'Select a step on the diagram'}>
          {selected ? (
            <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-[12px]">
              <dt className="text-kumo-inactive">BPMN element</dt>
              <dd className="text-kumo-default">{selected.type}</dd>
              <dt className="text-kumo-inactive">Lane</dt>
              <dd className="text-kumo-default">{project.toBe.lanes.find((l) => l.id === selected.laneId)?.label}</dd>
              <dt className="text-kumo-inactive">SLA</dt>
              <dd className="text-kumo-default">{selected.slaHours !== undefined ? `${selected.slaHours}h` : '—'}</dd>
              <dt className="text-kumo-inactive">Path</dt>
              <dd>{selected.isException ? <Pill tone="warning">Exception path</Pill> : <Pill tone="success">Main path</Pill>}</dd>
              <dt className="text-kumo-inactive">Implements</dt>
              <dd className="flex flex-wrap gap-1">
                {(selected.requirementIds ?? []).length === 0 ? (
                  <span className="text-kumo-subtle">No requirement</span>
                ) : (
                  selected.requirementIds?.map((id) => (
                    <button key={id} type="button" onClick={() => trace({ type: 'requirement', id })}>
                      <Pill tone="brand">{id}</Pill>
                    </button>
                  ))
                )}
              </dd>
              <dt className="text-kumo-inactive">Outgoing</dt>
              <dd className="text-kumo-default">
                {project.toBe.edges
                  .filter((e) => e.source === selected.id)
                  .map((e) => `${e.condition ?? 'default'} → ${project.toBe.nodes.find((n) => n.id === e.target)?.label}`)
                  .join(' · ') || '—'}
              </dd>
            </dl>
          ) : (
            <p className="text-[12px] text-kumo-subtle">Click any activity, gateway or event.</p>
          )}
          {selected && (
            <button
              type="button"
              onClick={() => trace({ type: 'node', id: selected.id })}
              className="mt-3 inline-flex h-7 items-center gap-1 rounded-lg border border-kumo-line px-2 text-[11.5px] text-kumo-default hover:bg-kumo-tint"
            >
              <TreeStructure size={12} /> Trace to outcomes
            </button>
          )}
        </Card>

        {project.decisionTables.map((table) => (
          <Card
            key={table.id}
            eyebrow={`DMN decision table · hit policy ${table.hitPolicy}`}
            title={`${table.id} ${table.name}`}
            className={selectedTable?.id === table.id ? 'ring-2 ring-kumo-brand' : ''}
            actions={
              <button type="button" onClick={() => setSelectedNodeId(table.nodeId)} className="text-[11.5px] text-kumo-brand hover:underline">
                Show gateway
              </button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11.5px]">
                <thead>
                  <tr className="border-b-2 border-kumo-line text-kumo-inactive">
                    <th className="py-1 pr-2 font-medium">#</th>
                    {table.inputs.map((input) => (
                      <th key={input} className="py-1 pr-2 font-medium">
                        {input}
                      </th>
                    ))}
                    <th className="border-l-2 border-kumo-line py-1 pl-2 pr-2 font-medium text-kumo-brand">{table.output}</th>
                    <th className="py-1 font-medium">Annotation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-kumo-line">
                  {table.rules.map((rule, index) => (
                    <tr key={index}>
                      <td className="py-1 pr-2 text-kumo-inactive">{index + 1}</td>
                      {rule.when.map((cell, cellIndex) => (
                        <td key={cellIndex} className="py-1 pr-2 text-kumo-default">
                          {cell}
                        </td>
                      ))}
                      <td className="border-l-2 border-kumo-line py-1 pl-2 pr-2">
                        <Pill tone={rule.result === 'High' ? 'danger' : rule.result === 'Medium' ? 'warning' : 'success'}>{rule.result}</Pill>
                      </td>
                      <td className="py-1 text-kumo-subtle">{rule.annotation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card eyebrow="As-is vs to-be" title="What the redesign changes">
          <table className="w-full text-left text-[12px]">
            <thead className="text-[11px] text-kumo-inactive">
              <tr>
                <th className="py-1 font-medium">Measure of the model</th>
                <th className="py-1 text-right font-medium">As-is</th>
                <th className="py-1 text-right font-medium">To-be</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-kumo-line">
              {STAT_LABELS.map(({ key, label, better }) => {
                const improved = better === 'lower' ? toBeStats[key] < asIsStats[key] : toBeStats[key] > asIsStats[key]
                return (
                  <tr key={key}>
                    <td className="py-1.5 text-kumo-default">{label}</td>
                    <td className="py-1.5 text-right text-kumo-subtle">{asIsStats[key]}</td>
                    <td className={`py-1.5 text-right font-semibold ${improved ? 'text-kumo-success' : 'text-kumo-default'}`}>{toBeStats[key]}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-kumo-subtle">
            Pain points designed out: {removedPain.map((p) => p.id).join(', ') || 'none'}.
          </p>
        </Card>

        <Card eyebrow="Exceptions & SLAs" title="Paths off the happy path">
          <ul className="space-y-1.5 text-[12px]">
            {project.toBe.edges
              .filter((e) => e.isException)
              .map((edge) => {
                const source = project.toBe.nodes.find((n) => n.id === edge.source)
                const target = project.toBe.nodes.find((n) => n.id === edge.target)
                return (
                  <li key={edge.id} className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-amber-500/60 px-2.5 py-1.5">
                    <span className="text-kumo-default">
                      {source?.label} → {target?.label}
                    </span>
                    {edge.condition && <Pill tone="warning">{edge.condition}</Pill>}
                  </li>
                )
              })}
          </ul>
          <p className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-kumo-inactive">Service levels</p>
          <div className="flex flex-wrap gap-1.5">
            {project.toBe.nodes
              .filter((n) => n.slaHours !== undefined)
              .map((n) => (
                <Pill key={n.id} tone={n.slaHours! >= 24 ? 'warning' : 'success'} title={n.label}>
                  {n.label.split(' ').slice(0, 3).join(' ')} · {n.slaHours! < 1 ? `${Math.round(n.slaHours! * 60)}m` : `${n.slaHours}h`}
                </Pill>
              ))}
          </div>
        </Card>
      </div>
    </StageFrame>
  )
}
