import type { RpcTarget } from 'capnweb'

/**
 * BA Studio artifact contract (`workflow-studio-demo/v1.1`) as returned by the BA Studio
 * gatekeeper's UI capability. This is the frontend's copy of the contract; the plumbing phase
 * moves it into a shared package so the gatekeeper and the UI use one definition.
 */

export type WorkflowNodeKind = 'trigger' | 'task' | 'decision' | 'integration' | 'approval' | 'end'

export type RequirementPriority = 'must' | 'should' | 'could' | 'wont'

export type Stakeholder = { id: string; name: string; role: string }

export type Requirement = {
  id: string
  title: string
  category: 'functional' | 'nonFunctional' | 'data' | 'integration' | 'compliance' | 'reporting'
  statement: string
  acceptanceCriteria: string[]
  priority: RequirementPriority
  ownerStakeholderId: string
  sourceStakeholderIds: string[]
  fitCriterion: string
  benefitHypothesis: string
  dependencies?: string[]
}

export type RaciAssignment = {
  activityId: string
  responsible: string[]
  accountable: string
  consulted: string[]
  informed: string[]
}

export type DecisionLogEntry = {
  id: string
  summary: string
  rationale: string
  requirementIds: string[]
  ownerStakeholderId: string
  status: 'proposed' | 'approved' | 'rejected' | 'superseded'
}

export type StakeholderSuggestion = {
  id: string
  name?: string
  role: string
  reason: string
  source: 'interview' | 'gapAnalysis'
  suggestedAt: string
}

export type Conflict = {
  id: string
  summary: string
  requirementIds: string[]
  stakeholderIds: string[]
  impact: 'scope' | 'cost' | 'timeline' | 'risk' | 'compliance'
  resolutionOwnerStakeholderId: string
  decision: { status: 'open' | 'inReview' | 'resolved' | 'deferred' | 'rejected' }
}

export type TradeoffOption = {
  id: string
  title: string
  summary: string
  scores: { userValue: number; deliveryEffort: number; operationalRisk: number; complianceFit: number }
  impacts: { scope: 'low' | 'medium' | 'high'; cost: 'low' | 'medium' | 'high'; timeline: 'low' | 'medium' | 'high'; risk: 'low' | 'medium' | 'high' }
}

export type SignoffApprover = {
  stakeholderId: string
  role: string
  decision: 'approved' | 'approvedWithConditions' | 'rejected'
  note?: string
}

export type WorkflowStudioDemoV11 = {
  contractVersion: 'workflow-studio-demo/v1.1'
  processName: string
  requirements: {
    schemaVersion: 'requirements/v1.1'
    processId: string
    generatedAt: string
    stakeholders: Stakeholder[]
    requirements: Requirement[]
    raci: RaciAssignment[]
    decisionLog: DecisionLogEntry[]
    stakeholderSuggestions?: StakeholderSuggestion[]
  }
  conflictRegister: {
    schemaVersion: 'conflicts/v1.1'
    processId: string
    conflicts: Conflict[]
  }
  processGraph: {
    schemaVersion: 'process-graph/v1.1'
    processId: string
    nodes: Array<{
      id: string
      type: WorkflowNodeKind
      label: string
      swimlaneStakeholderId?: string
      slaHours?: number
    }>
    edges: Array<{
      id: string
      source: string
      target: string
      condition?: string
    }>
  }
  tradeoffRegister: {
    schemaVersion: 'tradeoffs/v1.1'
    processId: string
    options: TradeoffOption[]
    preferredOptionId: string
  }
  signoffPacket: {
    schemaVersion: 'signoff/v1.1'
    processId: string
    baselineVersion: string
    approvedAt: string
    approvers: SignoffApprover[]
  }
  viewer: {
    selectedRequirementId: string
    highlightedConflictId: string
    highlightedTradeoffOptionId: string
  }
}

export type BaProjectRecord = {
  processId: string
  version: number
  updatedAt: string
  bundle: WorkflowStudioDemoV11
}

export type BaProjectSummary = {
  processId: string
  processName: string
  version: number
  createdAt: string
  updatedAt: string
}

export type WorkflowStepRecordV1 = {
  nodeId: string
  label: string
  type: WorkflowNodeKind
  status: 'completed' | 'skipped' | 'waitingForDecision' | 'waitingForApproval' | 'failed'
  enteredAt: string
  resolvedAt?: string
  chosenCondition?: string
  approvalDecision?: 'approved' | 'rejected'
  note?: string
}

export type WorkflowRunRecordV1 = {
  runId: string
  processId: string
  baselineVersion: string
  status: 'running' | 'waitingForInput' | 'completed' | 'failed'
  startedAt: string
  updatedAt: string
  completedAt?: string
  startedByNote?: string
  steps: WorkflowStepRecordV1[]
  pendingNodeId?: string
}

export interface BaUiApi extends RpcTarget {
  getProject(processId: string): Promise<BaProjectRecord | null>
  saveProject(processId: string, bundle: WorkflowStudioDemoV11): Promise<BaProjectRecord>
  getStakeholderSuggestions(bundle: WorkflowStudioDemoV11): Promise<StakeholderSuggestion[]>
  createStarterBundle(processId: string, processName: string): Promise<WorkflowStudioDemoV11>
  listProjects(): Promise<BaProjectSummary[]>
  createProject(processName: string): Promise<BaProjectRecord>
  startWorkflowRun(processId: string, note?: string): Promise<WorkflowRunRecordV1>
  advanceWorkflowRun(
    processId: string,
    runId: string,
    input: { condition?: string; approvalDecision?: 'approved' | 'rejected'; note?: string },
  ): Promise<WorkflowRunRecordV1>
  getWorkflowRun(processId: string, runId: string): Promise<WorkflowRunRecordV1 | null>
  listWorkflowRuns(processId: string): Promise<WorkflowRunRecordV1[]>
}
