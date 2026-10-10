import { useEffect, useMemo, useState } from 'react'
import { Play, ArrowCounterClockwise } from '@phosphor-icons/react'
import { Card, DemoDataBadge, formatMeasure, meetsTarget, Pill, ProgressBar } from '../ui'
import { useProject } from '../ProjectContext'
import ProcessDiagram from '../ProcessDiagram'
import { toWorkflowNodeKind } from '../prototype'
import type { ProcessModelEdge, ProcessModelNode } from '../prototype'
import type { Tone } from '../ui'
import type { WorkflowRunRecordV1, WorkflowStepRecordV1 } from '../types'
import StageFrame from './StageFrame'

const findingTone = { gap: 'danger', risk: 'warning', info: 'info' } as const satisfies Record<string, Tone>
const confidenceTone = { low: 'warning', medium: 'brand', high: 'success' } as const satisfies Record<string, Tone>

function stepStatus(node: ProcessModelNode, outgoing: ProcessModelEdge[]): WorkflowStepRecordV1['status'] {
  if (outgoing.length > 1) return 'waitingForDecision'
  if (node.approval) return 'waitingForApproval'
  return 'completed'
}

function makeStep(node: ProcessModelNode, status: WorkflowStepRecordV1['status'], chosenCondition?: string): WorkflowStepRecordV1 {
  const now = new Date().toISOString()
  return {
    nodeId: node.id,
    label: node.label,
    type: toWorkflowNodeKind(node),
    status,
    enteredAt: now,
    resolvedAt: status === 'completed' ? now : undefined,
    chosenCondition,
  }
}

/** Simulates the future-state process and validates measures, gaps and risks. */
export default function ValidateStage() {
  const { project, trace, persistence } = useProject()
  const [runCount, setRunCount] = useState(1)
  const [currentNodeId, setCurrentNodeId] = useState<string | undefined>()
  const [run, setRun] = useState<WorkflowRunRecordV1 | null>(null)
  const [resolvedFindings, setResolvedFindings] = useState<Record<string, boolean>>(() => Object.fromEntries(project.findings.map((finding) => [finding.id, finding.resolved])))

  const nodesById = useMemo(() => new Map(project.toBe.nodes.map((node) => [node.id, node])), [project.toBe.nodes])
  const outgoingBySource = useMemo(() => {
    const map = new Map<string, ProcessModelEdge[]>()
    for (const edge of project.toBe.edges) map.set(edge.source, [...(map.get(edge.source) ?? []), edge])
    return map
  }, [project.toBe.edges])
  const startNode = project.toBe.nodes.find((node) => node.type === 'startEvent')
  const currentNode = currentNodeId ? nodesById.get(currentNodeId) : undefined
  const outgoing = currentNode ? (outgoingBySource.get(currentNode.id) ?? []) : []
  const visited = useMemo(() => new Set(run?.steps.map((step) => step.nodeId) ?? []), [run?.steps])
  const elapsedSla = run?.steps.reduce((total, step) => total + (nodesById.get(step.nodeId)?.slaHours ?? 0), 0) ?? 0

  function startRun() {
    if (!startNode) return
    const now = new Date().toISOString()
    setRun({
      runId: `run-${runCount}`,
      processId: project.bundle.requirements.processId,
      baselineVersion: project.bundle.signoffPacket.baselineVersion,
      status: 'running',
      startedAt: now,
      updatedAt: now,
      startedByNote: 'Prototype walkthrough',
      steps: [],
    })
    setRunCount((count) => count + 1)
    setCurrentNodeId(startNode.id)
  }

  function resetRun() {
    setRun(null)
    setCurrentNodeId(undefined)
  }

  function upsertStep(node: ProcessModelNode, status: WorkflowStepRecordV1['status'], chosenCondition?: string) {
    setRun((current) => {
      if (!current) return current
      const existing = current.steps.findIndex((step) => step.nodeId === node.id)
      const step = makeStep(node, status, chosenCondition)
      const steps = existing === -1 ? [...current.steps, step] : current.steps.map((item, index) => (index === existing ? { ...item, ...step } : item))
      return { ...current, status: status === 'waitingForDecision' ? 'waitingForInput' : 'running', pendingNodeId: status === 'waitingForDecision' ? node.id : undefined, updatedAt: step.enteredAt, steps }
    })
  }

  function completeCurrentVia(edge: ProcessModelEdge) {
    if (!currentNode) return
    const now = new Date().toISOString()
    setRun((current) => {
      if (!current) return current
      return {
        ...current,
        status: 'running',
        pendingNodeId: undefined,
        updatedAt: now,
        steps: current.steps.map((step) =>
          step.nodeId === currentNode.id ? { ...step, status: 'completed', resolvedAt: now, chosenCondition: edge.condition } : step,
        ),
      }
    })
    setCurrentNodeId(edge.target)
  }

  useEffect(() => {
    if (!run || !currentNode) return undefined
    const nextEdges = outgoingBySource.get(currentNode.id) ?? []
    if (currentNode.type === 'endEvent' || nextEdges.length === 0) {
      upsertStep(currentNode, 'completed')
      const now = new Date().toISOString()
      setRun((current) => (current ? { ...current, status: 'completed', completedAt: now, updatedAt: now, pendingNodeId: undefined } : current))
      return undefined
    }

    const status = stepStatus(currentNode, nextEdges)
    upsertStep(currentNode, status)
    if (nextEdges.length > 1) return undefined

    const timer = window.setTimeout(() => {
      const [edge] = nextEdges
      completeCurrentVia(edge)
    }, currentNode.approval ? 700 : 500)
    return () => window.clearTimeout(timer)
  }, [currentNodeId])

  return (
    <StageFrame
      stage="validate"
      actions={
        <>
          <DemoDataBadge />
          <button type="button" onClick={startRun} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-kumo-brand px-3 text-[12px] font-medium text-white">
            <Play size={13} /> Start
          </button>
          <button type="button" onClick={resetRun} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-kumo-line px-3 text-[12px] text-kumo-subtle">
            <ArrowCounterClockwise size={13} /> Reset
          </button>
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
        <Card title="Step-by-step simulator" eyebrow={run ? `${run.runId} · ${run.status}` : 'Ready to walk'}>
          <ProcessDiagram model={project.toBe} painPoints={[]} activeNodeId={currentNodeId} highlightNodeIds={visited} height={430} onNodeClick={(id) => trace({ type: 'node', id })} />
          {run?.status === 'waitingForInput' && currentNode && (
            <div className="mt-3 rounded-lg border border-kumo-warning/50 bg-kumo-warning-tint p-3">
              <p className="text-[12px] font-medium text-kumo-default">Choose path from “{currentNode.label}”</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {outgoing.map((edge) => (
                  <button key={edge.id} type="button" onClick={() => completeCurrentVia(edge)} className="rounded-lg bg-kumo-base px-3 py-1.5 text-[12px] font-medium text-kumo-default shadow-sm">
                    {edge.condition ?? edge.target}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card title="Run log" eyebrow={`Elapsed SLA: ${elapsedSla.toFixed(1)}h`}>
          <div className="space-y-2">
            {(run?.steps ?? []).map((step, index) => (
              <div key={`${step.nodeId}-${index}`} className="rounded-lg bg-kumo-tint p-2 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <button type="button" onClick={() => trace({ type: 'node', id: step.nodeId })} className="font-medium text-kumo-brand hover:underline">
                    {step.label}
                  </button>
                  <Pill tone={step.status === 'completed' ? 'success' : step.status === 'waitingForApproval' ? 'warning' : 'brand'}>{step.status}</Pill>
                </div>
                <p className="text-kumo-subtle">{step.type}{step.chosenCondition ? ` · chose ${step.chosenCondition}` : ''}</p>
              </div>
            ))}
            {!run && <p className="text-[12px] text-kumo-subtle">Press Start to create a client-side run record.</p>}
          </div>
        </Card>
      </div>

      <Card title="Projected effect on measures" eyebrow="Baseline → projected vs target">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <thead className="text-kumo-inactive">
              <tr>
                <th className="border-b border-kumo-line py-2 font-medium">Measure</th>
                <th className="border-b border-kumo-line py-2 font-medium">Baseline</th>
                <th className="border-b border-kumo-line py-2 font-medium">Projected</th>
                <th className="border-b border-kumo-line py-2 font-medium">Target</th>
                <th className="border-b border-kumo-line py-2 font-medium">Confidence</th>
                <th className="border-b border-kumo-line py-2 font-medium">Basis</th>
              </tr>
            </thead>
            <tbody>
              {project.projections.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-kumo-subtle">No projected effect recorded. Measurements below are sourced observations, not a forecast.</td>
                </tr>
              )}
              {project.projections.map((projection) => {
                const measure = project.framing.measures.find((item) => item.id === projection.measureId)
                if (!measure) return null
                return (
                  <tr key={projection.measureId}>
                    <td className="border-b border-kumo-line/70 py-3 pr-3 text-kumo-default">{measure.name}</td>
                    <td className="border-b border-kumo-line/70 py-3 pr-3 text-kumo-subtle">{formatMeasure(measure.baseline, measure)}</td>
                    <td className="border-b border-kumo-line/70 py-3 pr-3">
                      <div className="flex items-center gap-2 text-kumo-default">
                        {formatMeasure(projection.projected, measure)}
                        <Pill tone={meetsTarget(measure, projection.projected) ? 'success' : 'warning'}>{meetsTarget(measure, projection.projected) ? 'meets target' : 'shortfall'}</Pill>
                      </div>
                      <ProgressBar value={Math.abs((projection.projected - measure.baseline) / (measure.target - measure.baseline || 1))} tone={meetsTarget(measure, projection.projected) ? 'success' : 'warning'} />
                    </td>
                    <td className="border-b border-kumo-line/70 py-3 pr-3 text-kumo-subtle">{formatMeasure(measure.target, measure)}</td>
                    <td className="border-b border-kumo-line/70 py-3 pr-3"><Pill tone={confidenceTone[projection.confidence]}>{projection.confidence}</Pill></td>
                    <td className="border-b border-kumo-line/70 py-3 text-kumo-subtle">{projection.basis}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Validation findings" eyebrow={persistence === 'live' ? 'Saved findings' : 'Local resolved toggles'}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {project.findings.map((finding) => (
            <article key={finding.id} className="rounded-lg border border-kumo-line bg-kumo-elevated p-3">
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-[13px] font-semibold text-kumo-default">{finding.title}</h4>
                <Pill tone={findingTone[finding.severity]}>{finding.severity}</Pill>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-kumo-subtle">{finding.detail}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
                {finding.nodeId && <button type="button" onClick={() => trace({ type: 'node', id: finding.nodeId! })} className="text-kumo-brand hover:underline">Node {finding.nodeId}</button>}
                {finding.requirementId && <button type="button" onClick={() => trace({ type: 'requirement', id: finding.requirementId! })} className="text-kumo-brand hover:underline">Requirement {finding.requirementId}</button>}
              </div>
              {persistence === 'live' ? (
                <p className="mt-3 text-[12px] text-kumo-subtle">
                  {finding.resolved ? 'Resolved in the saved project.' : 'Open. Record the resolution in the findings editor below.'}
                </p>
              ) : (
                <label className="mt-3 flex items-center gap-2 text-[12px] text-kumo-subtle">
                  <input type="checkbox" checked={resolvedFindings[finding.id] ?? false} onChange={(event) => setResolvedFindings((current) => ({ ...current, [finding.id]: event.target.checked }))} />
                  Resolved in walkthrough
                </label>
              )}
            </article>
          ))}
        </div>
      </Card>
    </StageFrame>
  )
}
