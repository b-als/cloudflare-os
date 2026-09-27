import type { WorkflowNodeKind, WorkflowStudioDemoV11 } from './types'

/**
 * Prototype extensions to the BA Studio contract (see `./types.ts`). These describe the artifacts
 * the end-to-end journey needs that `workflow-studio-demo/v1.1` does not carry yet: outcomes and
 * measures, SIPOC, as-is vs to-be models, DMN decision tables, outcome-scored trade-offs,
 * validation, baselines and monitoring. Screens read them from demo data today; the plumbing
 * phase promotes them into the shared contract served by the BA Studio gatekeeper.
 */

/** The ordered stages of a BA Studio project, one screen each. */
export type StageId =
  | 'outcomes'
  | 'stakeholders'
  | 'as-is'
  | 'requirements'
  | 'to-be'
  | 'tradeoffs'
  | 'validate'
  | 'signoff'
  | 'handoff'
  | 'monitor'

export type StageStatus = 'done' | 'active' | 'attention' | 'notStarted'

export type Measure = {
  id: string
  outcomeId: string
  name: string
  unit: string
  baseline: number
  target: number
  /** Whether a lower or higher value is better. */
  direction: 'decrease' | 'increase'
  source: string
  cadence: string
}

export type Outcome = {
  id: string
  title: string
  statement: string
  ownerStakeholderId: string
  /** SMART check the agent runs on every outcome before the stage can close. */
  smart: { specific: boolean; measurable: boolean; achievable: boolean; relevant: boolean; timeBound: boolean }
}

export type OutcomeFraming = {
  problemStatement: string
  benefitHypothesis: string
  scopeIn: string[]
  scopeOut: string[]
  assumptions: string[]
  constraints: string[]
  outcomes: Outcome[]
  measures: Measure[]
}

export type StakeholderProfile = {
  stakeholderId: string
  /** 1 (low) – 5 (high). */
  influence: number
  /** 1 (low) – 5 (high). */
  interest: number
  stance: 'champion' | 'supporter' | 'neutral' | 'sceptic'
  engagement: string
}

export type Sipoc = {
  suppliers: string[]
  inputs: string[]
  process: string[]
  outputs: string[]
  customers: string[]
}

/** BPMN 2.0 element vocabulary used by the process models (rendered in a simplified style). */
export type BpmnElementType =
  | 'startEvent'
  | 'endEvent'
  | 'timerEvent'
  | 'userTask'
  | 'serviceTask'
  | 'manualTask'
  | 'exclusiveGateway'
  | 'parallelGateway'

export type ProcessLane = { id: string; label: string; stakeholderId?: string }

export type ProcessModelNode = {
  id: string
  type: BpmnElementType
  label: string
  laneId: string
  /** Horizontal position in the swimlane grid. */
  column: number
  slaHours?: number
  approval?: boolean
  requirementIds?: string[]
  decisionTableId?: string
  isException?: boolean
}

export type ProcessModelEdge = {
  id: string
  source: string
  target: string
  condition?: string
  isException?: boolean
}

export type ProcessModel = {
  lanes: ProcessLane[]
  nodes: ProcessModelNode[]
  edges: ProcessModelEdge[]
}

export type WasteType =
  | 'waiting'
  | 'rework'
  | 'handoff'
  | 'overprocessing'
  | 'defects'
  | 'motion'

export type PainPoint = {
  id: string
  nodeId: string
  title: string
  wasteType: WasteType
  /** Measured annual cost in GBP. */
  annualCost: number
  evidence: string
  measureId?: string
}

/** DMN decision table attached to a gateway in the to-be model. */
export type DecisionTable = {
  id: string
  name: string
  nodeId: string
  hitPolicy: 'UNIQUE' | 'FIRST' | 'PRIORITY' | 'COLLECT'
  inputs: string[]
  output: string
  rules: Array<{ when: string[]; result: string; annotation?: string }>
}

export type TradeoffOutcomeImpact = {
  optionId: string
  outcomeId: string
  /** -2 (strongly harms) … +2 (strongly advances). */
  impact: number
  rationale: string
}

export type MeasureProjection = {
  measureId: string
  projected: number
  confidence: 'low' | 'medium' | 'high'
  basis: string
}

export type ValidationFinding = {
  id: string
  severity: 'gap' | 'risk' | 'info'
  title: string
  detail: string
  nodeId?: string
  requirementId?: string
  resolved: boolean
}

export type BaselineChange = {
  kind: 'added' | 'changed' | 'removed'
  artifact: 'outcome' | 'requirement' | 'processStep' | 'decision' | 'conflict'
  ref: string
  summary: string
}

export type BaselineVersion = {
  version: string
  createdAt: string
  author: string
  summary: string
  status: 'draft' | 'inReview' | 'baselined' | 'superseded'
  changes: BaselineChange[]
}

export type BuildTarget = {
  id: string
  kind: 'gadget' | 'scheduled' | 'automation'
  title: string
  description: string
  fit: 'recommended' | 'possible'
  coversNodeIds: string[]
}

export type MonitoringSeries = {
  measureId: string
  points: Array<{ period: string; actual: number }>
}

export type ProjectSummary = {
  id: string
  processName: string
  sponsor: string
  currentStage: StageId
  updatedAt: string
  outcomeHealth: 'onTrack' | 'atRisk' | 'offTrack'
  openConflicts: number
  pendingSignoffs: number
  /** Whether this project has a full worked dataset that can be opened. */
  openable: boolean
}

/** One fully worked BA Studio project: the existing contract bundle plus prototype extensions. */
export type BaPrototypeProject = {
  summary: ProjectSummary
  stageStatus: Record<StageId, StageStatus>
  bundle: WorkflowStudioDemoV11
  framing: OutcomeFraming
  /** Requirement id → outcome ids it advances (outcome → requirement traceability). */
  requirementOutcomes: Record<string, string[]>
  stakeholderProfiles: StakeholderProfile[]
  sipoc: Sipoc
  asIs: ProcessModel
  painPoints: PainPoint[]
  toBe: ProcessModel
  decisionTables: DecisionTable[]
  tradeoffImpacts: TradeoffOutcomeImpact[]
  projections: MeasureProjection[]
  findings: ValidationFinding[]
  versions: BaselineVersion[]
  buildTargets: BuildTarget[]
  monitoring: MonitoringSeries[]
}

/** Maps a BPMN element onto the contract's coarser `WorkflowNodeKind`. */
export function toWorkflowNodeKind(node: ProcessModelNode): WorkflowNodeKind {
  switch (node.type) {
    case 'startEvent':
      return 'trigger'
    case 'endEvent':
      return 'end'
    case 'serviceTask':
      return 'integration'
    case 'exclusiveGateway':
    case 'parallelGateway':
      return 'decision'
    default:
      return node.approval ? 'approval' : 'task'
  }
}

/** Projects a prototype process model into the contract's `processGraph` shape. */
export function toProcessGraph(
  processId: string,
  model: ProcessModel,
): WorkflowStudioDemoV11['processGraph'] {
  const laneStakeholder = new Map(model.lanes.map((lane) => [lane.id, lane.stakeholderId]))
  return {
    schemaVersion: 'process-graph/v1.1',
    processId,
    nodes: model.nodes.map((node) => ({
      id: node.id,
      type: toWorkflowNodeKind(node),
      label: node.label,
      swimlaneStakeholderId: laneStakeholder.get(node.laneId),
      slaHours: node.slaHours,
    })),
    edges: model.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      condition: edge.condition,
    })),
  }
}
