import type { DecisionLogEntry, Requirement } from './types'
import type { DecisionTable, Measure, Outcome, BaPrototypeProject, ProcessModelNode } from './prototype'
import type { TraceFocus } from './ProjectContext'

export type TraceChain = {
  outcomes: Outcome[]
  measures: Measure[]
  requirements: Requirement[]
  nodes: ProcessModelNode[]
  decisions: DecisionLogEntry[]
  decisionTables: DecisionTable[]
}

/**
 * Resolves the outcome → measure → requirement → process step → decision chain around one
 * artifact. Requirements are the hinge: outcomes reach steps through the requirements that
 * advance them, and steps reach outcomes through the requirements they implement.
 */
export function traceChain(project: BaPrototypeProject, focus: TraceFocus): TraceChain {
  const allRequirements = project.bundle.requirements.requirements
  const requirementIds = new Set<string>()
  const outcomeIds = new Set<string>()
  let nodes: ProcessModelNode[]

  if (focus.type === 'outcome') {
    outcomeIds.add(focus.id)
    for (const [reqId, outcomes] of Object.entries(project.requirementOutcomes)) {
      if (outcomes.includes(focus.id)) requirementIds.add(reqId)
    }
  } else if (focus.type === 'requirement') {
    requirementIds.add(focus.id)
    for (const id of project.requirementOutcomes[focus.id] ?? []) outcomeIds.add(id)
  } else {
    const node = project.toBe.nodes.find((n) => n.id === focus.id)
    for (const id of node?.requirementIds ?? []) requirementIds.add(id)
    for (const reqId of requirementIds) for (const id of project.requirementOutcomes[reqId] ?? []) outcomeIds.add(id)
  }

  if (focus.type === 'node') {
    nodes = project.toBe.nodes.filter((n) => n.id === focus.id)
  } else {
    nodes = project.toBe.nodes.filter((n) => n.requirementIds?.some((id) => requirementIds.has(id)))
  }
  const nodeIds = new Set(nodes.map((n) => n.id))

  return {
    outcomes: project.framing.outcomes.filter((o) => outcomeIds.has(o.id)),
    measures: project.framing.measures.filter((m) => outcomeIds.has(m.outcomeId)),
    requirements: allRequirements.filter((r) => requirementIds.has(r.id)),
    nodes,
    decisions: project.bundle.requirements.decisionLog.filter((d) => d.requirementIds.some((id) => requirementIds.has(id))),
    decisionTables: project.decisionTables.filter((t) => nodeIds.has(t.nodeId)),
  }
}

/** Requirements that do not advance any outcome — the agent flags these as traceability gaps. */
export function orphanRequirements(project: BaPrototypeProject): Requirement[] {
  return project.bundle.requirements.requirements.filter(
    (r) => r.priority !== 'wont' && (project.requirementOutcomes[r.id]?.length ?? 0) === 0,
  )
}
