import type {
  BaArtifact, BaBaseline, BaFinding, BaHandoff, BaMeasurement, BaOutcome, BaRequirement, BaStakeholder,
  BaTradeoff, ProcessEdge, ProcessGraph, ProcessNode,
} from '@gadgets/gatekeeper-process/types'
import type { ProjectSnapshot } from '@gadgets/gatekeeper-process/ui-types'
import type {
  BaselineChange, BaselineVersion, BaPrototypeProject, PainPoint, ProcessModel, ProcessModelEdge,
  ProcessModelNode, StageId, StageStatus, StakeholderProfile, TradeoffOutcomeImpact, WasteType,
} from './prototype'
import type { Conflict, RaciAssignment, Requirement, TradeoffOption } from './types'
import { toProcessGraph } from './prototype'

const STAGES: StageId[] = [
  'outcomes', 'stakeholders', 'as-is', 'requirements', 'to-be', 'tradeoffs', 'validate', 'signoff', 'handoff', 'monitor',
]

/** Turns one saved project into the shape the stage screens render. */
export function liveProjectView(snapshot: ProjectSnapshot, workspaceId: string): BaPrototypeProject {
  const artifacts = snapshot.lifecycle?.artifacts ?? []
  const outcomes = artifacts.filter((artifact): artifact is BaOutcome => artifact.kind === 'outcome')
  const stakeholders = artifacts.filter((artifact): artifact is BaStakeholder => artifact.kind === 'stakeholder')
  const requirements = artifacts.filter((artifact): artifact is BaRequirement => artifact.kind === 'requirement')
  const tradeoffs = artifacts.filter((artifact): artifact is BaTradeoff => artifact.kind === 'tradeoff')
  const findings = artifacts.filter((artifact): artifact is BaFinding => artifact.kind === 'finding')
  const handoffs = artifacts.filter((artifact): artifact is BaHandoff => artifact.kind === 'handoff')
  const measurements = artifacts.filter((artifact): artifact is BaMeasurement => artifact.kind === 'measurement')
  const asIs = toModel(snapshot.graph, requirements)
  const toBe = toModel(snapshot.lifecycle?.toBe ?? { revision: 0, lanes: [], nodes: [], edges: [] }, requirements)
  const requirementOutcomes = Object.fromEntries(requirements.map((requirement) => [requirement.id, requirement.outcomeIds]))
  const profiles = stakeholders.map(profileOf)
  const options = tradeoffs.flatMap(tradeoffOptions)
  const preferred = options.find((option) => option.summary.startsWith('Selected. '))?.id ?? ''
  const versions = baselineVersions(snapshot.lifecycle?.baselines ?? [])
  const latestApproved = [...(snapshot.lifecycle?.baselines ?? [])].reverse().find((baseline) => baseline.review?.decision === 'approved')
  const processId = snapshot.projectId
  const measures = outcomes.map((outcome) => ({
    id: outcome.id,
    outcomeId: outcome.id,
    name: outcome.metric || outcome.title,
    unit: outcome.unit || 'count',
    baseline: outcome.baseline ?? 0,
    target: outcome.target ?? 0,
    direction: outcome.direction,
    source: latestSource(measurements, outcome.id),
    cadence: outcome.due ? `Due ${outcome.due}` : 'Not scheduled',
  }))

  const bundle: BaPrototypeProject['bundle'] = {
    contractVersion: 'workflow-studio-demo/v1.1',
    processName: snapshot.name,
    requirements: {
      schemaVersion: 'requirements/v1.1',
      processId,
      generatedAt: new Date(0).toISOString(),
      stakeholders: stakeholders.map((stakeholder) => ({ id: stakeholder.id, name: stakeholder.title, role: stakeholder.role })),
      requirements: requirements.map((requirement) => toRequirement(requirement, stakeholders)),
      raci: raciRows(snapshot.lifecycle?.toBe ?? snapshot.graph, stakeholders),
      decisionLog: snapshot.decisions.map((decision) => ({
        id: decision.decisionId,
        summary: decision.summary,
        rationale: decision.rationale,
        requirementIds: [],
        ownerStakeholderId: stakeholders[0]?.id ?? '',
        status: decision.status === 'superseded' ? 'superseded' : 'approved',
      })),
      stakeholderSuggestions: [],
    },
    conflictRegister: {
      schemaVersion: 'conflicts/v1.1',
      processId,
      conflicts: tradeoffs.map(conflictOf),
    },
    processGraph: toProcessGraph(processId, toBe.nodes.length ? toBe : asIs),
    tradeoffRegister: { schemaVersion: 'tradeoffs/v1.1', processId, options, preferredOptionId: preferred },
    signoffPacket: {
      schemaVersion: 'signoff/v1.1',
      processId,
      baselineVersion: latestApproved ? 'approved' : versions.at(-1)?.version ?? 'none',
      approvedAt: latestApproved?.review ? new Date(latestApproved.review.at).toISOString() : '',
      approvers: (snapshot.lifecycle?.baselines ?? []).flatMap((baseline) => baseline.review ? [{
        stakeholderId: stakeholders[0]?.id ?? baseline.review.accountId,
        role: 'Creating account',
        decision: baseline.review.decision === 'approved' ? 'approved' as const : 'rejected' as const,
        note: baseline.review.note,
      }] : []),
    },
    viewer: { selectedRequirementId: requirements[0]?.id ?? '', highlightedConflictId: '', highlightedTradeoffOptionId: preferred },
  }

  return {
    summary: {
      id: workspaceId,
      processName: snapshot.name,
      sponsor: stakeholders[0]?.title ?? 'Unassigned',
      currentStage: 'as-is',
      updatedAt: new Date(0).toISOString(),
      outcomeHealth: 'atRisk',
      openConflicts: tradeoffs.filter((tradeoff) => !tradeoff.selection).length,
      pendingSignoffs: latestApproved ? 0 : 1,
      openable: true,
    },
    stageStatus: Object.fromEntries(STAGES.map((stage) => [stage, stageStatus(stage, {
      artifacts, asIs, toBe, baselines: snapshot.lifecycle?.baselines ?? [],
    })])) as Record<StageId, StageStatus>,
    bundle,
    framing: {
      problemStatement: outcomes.find((outcome) => outcome.statement?.trim())?.statement ?? 'No problem statement recorded yet.',
      benefitHypothesis: outcomes.length
        ? outcomes.map((outcome) => `${outcome.title}: ${outcome.baseline ?? '—'} → ${outcome.target ?? '—'} ${outcome.unit}`).join(' ')
        : 'No outcomes recorded yet.',
      scopeIn: requirements.filter((requirement) => requirement.priority !== 'wont').map((requirement) => requirement.title),
      scopeOut: requirements.filter((requirement) => requirement.priority === 'wont').map((requirement) => requirement.title),
      assumptions: snapshot.openQuestions.map((question) => question.text),
      constraints: tradeoffs.map((tradeoff) => tradeoff.rationale).filter(Boolean),
      outcomes: outcomes.map((outcome) => ({
        id: outcome.id,
        title: outcome.title,
        statement: outcome.statement?.trim() || outcome.metric || outcome.title,
        ownerStakeholderId: stakeholders[0]?.id ?? '',
        smart: {
          specific: (outcome.statement?.trim() || outcome.title).length >= 12,
          measurable: Boolean(outcome.metric.trim() && outcome.unit.trim() && outcome.baseline !== null && outcome.target !== null),
          achievable: outcome.baseline !== null && outcome.target !== null &&
            (outcome.direction === 'increase' ? outcome.target > outcome.baseline : outcome.target < outcome.baseline),
          relevant: requirements.some((requirement) => requirement.outcomeIds.includes(outcome.id)),
          timeBound: Boolean(outcome.due),
        },
      })),
      measures,
    },
    requirementOutcomes,
    stakeholderProfiles: profiles,
    sipoc: {
      suppliers: asIs.lanes.map((lane) => lane.label),
      inputs: unique(asIs.nodes.flatMap((node) => nodeInputs(snapshot.graph, node.id))),
      process: asIs.nodes.filter((node) => node.type.endsWith('Task')).map((node) => node.label),
      outputs: unique(asIs.nodes.flatMap((node) => nodeOutputs(snapshot.graph, node.id))),
      customers: asIs.nodes.filter((node) => node.type === 'endEvent').map((node) => node.label),
    },
    asIs,
    painPoints: painPoints(snapshot.graph, outcomes),
    toBe,
    decisionTables: [],
    tradeoffImpacts: tradeoffImpacts(tradeoffs, requirements),
    projections: [],
    findings: findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity === 'blocking' ? 'gap' : 'risk',
      title: finding.title,
      detail: finding.resolution || finding.status,
      requirementId: undefined,
      resolved: finding.status === 'resolved',
    })),
    versions,
    buildTargets: handoffs.map((handoff) => ({
      id: handoff.id,
      kind: 'gadget' as const,
      title: handoff.title,
      description: `${handoff.description} Owner: ${handoff.owner}. Status: ${handoff.status}.`,
      fit: handoff.status === 'done' ? 'possible' as const : 'recommended' as const,
      coversNodeIds: requirements.filter((requirement) => handoff.requirementIds.includes(requirement.id)).flatMap((requirement) => requirement.nodeIds),
    })),
    monitoring: outcomes.map((outcome) => ({
      measureId: outcome.id,
      points: measurements.filter((measurement) => measurement.outcomeId === outcome.id)
        .toSorted((a, b) => a.measuredAt - b.measuredAt)
        .map((measurement) => ({ period: new Date(measurement.measuredAt).toISOString().slice(0, 10), actual: measurement.value })),
    })),
  }
}

function toModel(graph: ProcessGraph, requirements: BaRequirement[]): ProcessModel {
  const columns = [...new Set(graph.nodes.map((node) => node.x))].toSorted((a, b) => a - b)
  return {
    lanes: graph.lanes.map((lane) => ({ id: lane.id, label: lane.label })),
    nodes: graph.nodes.map((node): ProcessModelNode => ({
      id: node.id,
      type: node.type,
      label: node.label,
      laneId: node.laneId,
      column: Math.max(0, columns.indexOf(node.x)),
      slaHours: slaHours(node),
      requirementIds: requirements.filter((requirement) => requirement.nodeIds.includes(node.id)).map((requirement) => requirement.id),
      isException: graph.edges.some((edge) => edge.target === node.id && exceptionLabel(edge)),
    })),
    edges: graph.edges.map((edge): ProcessModelEdge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      condition: edge.label,
      isException: exceptionLabel(edge),
    })),
  }
}

function slaHours(node: ProcessNode): number | undefined {
  if (!node.duration) return undefined
  if (node.duration.unit === 'days') return node.duration.amount * 24
  if (node.duration.unit === 'minutes') return node.duration.amount / 60
  return node.duration.amount
}

function exceptionLabel(edge: ProcessEdge): boolean {
  return /^(no|missing|reject|fail|escalat)/i.test(edge.label ?? '')
}

function nodeInputs(graph: ProcessGraph, id: string): string[] {
  return graph.nodes.find((node) => node.id === id)?.inputs ?? []
}

function nodeOutputs(graph: ProcessGraph, id: string): string[] {
  return graph.nodes.find((node) => node.id === id)?.outputs ?? []
}

function painPoints(graph: ProcessGraph, outcomes: BaOutcome[]): PainPoint[] {
  return graph.nodes.filter((node) => node.painPoints?.trim()).map((node) => ({
    id: `pain-${node.id}`,
    nodeId: node.id,
    title: node.label,
    wasteType: wasteType(node.painPoints ?? ''),
    annualCost: 0,
    evidence: node.painPoints ?? '',
    measureId: outcomes[0]?.id,
  }))
}

function wasteType(text: string): WasteType {
  const value = text.toLowerCase()
  if (value.includes('wait') || value.includes('stall') || value.includes('sit')) return 'waiting'
  if (value.includes('re-key') || value.includes('rekey') || value.includes('again')) return 'rework'
  if (value.includes('hand')) return 'handoff'
  if (value.includes('wrong') || value.includes('defect')) return 'defects'
  if (value.includes('walk') || value.includes('travel')) return 'motion'
  return 'overprocessing'
}

function profileOf(stakeholder: BaStakeholder): StakeholderProfile {
  return {
    stakeholderId: stakeholder.id,
    influence: stakeholder.influence ?? 3,
    interest: stakeholder.interest ?? 3,
    stance: stakeholder.stance ?? 'neutral',
    engagement: stakeholder.notes,
  }
}

function toRequirement(requirement: BaRequirement, stakeholders: BaStakeholder[]): Requirement {
  return {
    id: requirement.id,
    title: requirement.title,
    category: 'functional',
    statement: requirement.statement,
    acceptanceCriteria: requirement.acceptanceCriteria,
    priority: requirement.priority,
    ownerStakeholderId: requirement.stakeholderIds[0] ?? stakeholders[0]?.id ?? '',
    sourceStakeholderIds: requirement.stakeholderIds,
    fitCriterion: requirement.acceptanceCriteria[0] ?? '',
    benefitHypothesis: requirement.source,
  }
}

function raciRows(graph: ProcessGraph, stakeholders: BaStakeholder[]): RaciAssignment[] {
  return graph.nodes.filter((node) => node.type.endsWith('Task')).map((node) => {
    const owner = stakeholders.find((stakeholder) => matchesOwner(stakeholder, node.owner ?? ''))
    const responsible = owner ? [owner.id] : []
    return {
      activityId: node.id,
      responsible,
      accountable: responsible[0] ?? '',
      consulted: [],
      informed: [],
    }
  })
}

function matchesOwner(stakeholder: BaStakeholder, owner: string): boolean {
  const needle = owner.trim().toLowerCase()
  if (!needle) return false
  return stakeholder.title.toLowerCase() === needle || stakeholder.role.toLowerCase() === needle
}

function tradeoffOptions(tradeoff: BaTradeoff): TradeoffOption[] {
  return tradeoff.options.map((option, index) => {
    const selected = option === tradeoff.selection
    return {
      id: `${tradeoff.id}:${index}`,
      title: option,
      summary: selected ? `Selected. ${tradeoff.rationale}` : tradeoff.title,
      scores: { userValue: selected ? 4 : 2, deliveryEffort: 3, operationalRisk: 3, complianceFit: 3 },
      impacts: { scope: 'medium', cost: 'medium', timeline: 'medium', risk: 'medium' },
    }
  })
}

function tradeoffImpacts(tradeoffs: BaTradeoff[], requirements: BaRequirement[]): TradeoffOutcomeImpact[] {
  const impacts: TradeoffOutcomeImpact[] = []
  for (const tradeoff of tradeoffs) {
    const outcomeIds = [...new Set(requirements.filter((requirement) => tradeoff.requirementIds.includes(requirement.id)).flatMap((requirement) => requirement.outcomeIds))]
    tradeoff.options.forEach((option, index) => {
      for (const outcomeId of outcomeIds) {
        impacts.push({
          optionId: `${tradeoff.id}:${index}`,
          outcomeId,
          impact: option === tradeoff.selection ? 2 : 0,
          rationale: tradeoff.rationale,
        })
      }
    })
  }
  return impacts
}

function conflictOf(tradeoff: BaTradeoff): Conflict {
  return {
    id: tradeoff.id,
    summary: tradeoff.title,
    requirementIds: tradeoff.requirementIds,
    stakeholderIds: [],
    impact: 'scope',
    resolutionOwnerStakeholderId: '',
    decision: { status: tradeoff.selection ? 'resolved' : 'open' },
  }
}

function baselineVersions(baselines: BaBaseline[]): BaselineVersion[] {
  return baselines.map((baseline, index) => {
    const previous = baselines[index - 1]
    return {
      version: String(index + 1),
      createdAt: new Date(baseline.createdAt).toISOString(),
      author: baseline.review?.accountId ?? 'Not reviewed',
      summary: baseline.review?.note || `Captured revision ${baseline.content.revision}`,
      status: baseline.review?.decision === 'approved' ? 'baselined' : baseline.review?.decision === 'rejected' ? 'superseded' : 'inReview',
      changes: [
        ...diffArtifacts(previous?.content.artifacts, baseline.content.artifacts),
        ...diffSteps(previous?.content.asIs, baseline.content.asIs),
      ],
    }
  })
}

function diffArtifacts(previous: BaArtifact[] | undefined, current: BaArtifact[]): BaselineChange[] {
  const before = new Map((previous ?? []).map((artifact) => [artifact.id, artifact]))
  const changes: BaselineChange[] = []
  for (const artifact of current) {
    const prior = before.get(artifact.id)
    const artifactKind = changeKind(artifact.kind)
    if (!prior) changes.push({ kind: 'added', artifact: artifactKind, ref: artifact.id, summary: artifact.title })
    else if (JSON.stringify(prior) !== JSON.stringify(artifact)) {
      changes.push({ kind: 'changed', artifact: artifactKind, ref: artifact.id, summary: artifact.title })
    }
    before.delete(artifact.id)
  }
  for (const artifact of before.values()) {
    changes.push({ kind: 'removed', artifact: changeKind(artifact.kind), ref: artifact.id, summary: artifact.title })
  }
  return changes
}

function changeKind(kind: BaArtifact['kind']): BaselineChange['artifact'] {
  switch (kind) {
    case 'outcome': return 'outcome'
    case 'requirement': return 'requirement'
    case 'stakeholder':
    case 'tradeoff':
    case 'scenario':
    case 'finding':
    case 'measurement':
    case 'handoff':
      return 'decision'
    default: {
      const unreachable: never = kind
      return unreachable
    }
  }
}

function latestSource(measurements: BaMeasurement[], outcomeId: string): string {
  const latest = measurements.filter((measurement) => measurement.outcomeId === outcomeId).toSorted((a, b) => b.measuredAt - a.measuredAt)[0]
  return latest?.source ?? 'Not recorded'
}

function stageStatus(stage: StageId, input: {
  artifacts: BaArtifact[]
  asIs: ProcessModel
  toBe: ProcessModel
  baselines: BaBaseline[]
}): StageStatus {
  const has = (kind: BaArtifact['kind']) => input.artifacts.some((artifact) => artifact.kind === kind)
  switch (stage) {
    case 'as-is': return input.asIs.nodes.length > 0 ? 'done' : 'notStarted'
    case 'to-be': return input.toBe.nodes.length > 0 ? 'done' : 'notStarted'
    case 'signoff': return input.baselines.some((baseline) => baseline.review?.decision === 'approved')
      ? 'done'
      : input.baselines.length > 0 ? 'attention' : 'notStarted'
    case 'outcomes':
    case 'stakeholders':
    case 'requirements':
    case 'tradeoffs':
    case 'validate':
    case 'handoff':
    case 'monitor':
      return has(stageKind(stage)) ? 'done' : 'notStarted'
    default: {
      const unreachable: never = stage
      return unreachable
    }
  }
}

function stageKind(stage: 'outcomes' | 'stakeholders' | 'requirements' | 'tradeoffs' | 'validate' | 'handoff' | 'monitor'): BaArtifact['kind'] {
  switch (stage) {
    case 'outcomes': return 'outcome'
    case 'stakeholders': return 'stakeholder'
    case 'requirements': return 'requirement'
    case 'tradeoffs': return 'tradeoff'
    case 'validate': return 'scenario'
    case 'handoff': return 'handoff'
    case 'monitor': return 'measurement'
    default: {
      const unreachable: never = stage
      return unreachable
    }
  }
}

function diffSteps(previous: ProcessGraph | undefined, current: ProcessGraph): BaselineChange[] {
  const before = new Map((previous?.nodes ?? []).map((node) => [node.id, node]))
  const changes: BaselineChange[] = []
  for (const node of current.nodes) {
    const prior = before.get(node.id)
    if (!prior) changes.push({ kind: 'added', artifact: 'processStep', ref: node.id, summary: node.label })
    else if (prior.label !== node.label || prior.type !== node.type) {
      changes.push({ kind: 'changed', artifact: 'processStep', ref: node.id, summary: node.label })
    }
    before.delete(node.id)
  }
  for (const node of before.values()) {
    changes.push({ kind: 'removed', artifact: 'processStep', ref: node.id, summary: node.label })
  }
  return changes
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
