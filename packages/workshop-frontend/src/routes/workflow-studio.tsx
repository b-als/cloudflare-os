import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { createFileRoute } from '@tanstack/react-router'
import { memo, useCallback, useMemo, useState } from 'react'
import { useDocumentTitle } from '../useDocumentTitle'
import '@xyflow/react/dist/style.css'

type WorkflowNodeKind = 'trigger' | 'task' | 'decision' | 'approval' | 'end'

type WorkflowNodeData = {
  label: string
  kind: WorkflowNodeKind
  lane: string
  slaHours?: number
}

// ---------------------------------------------------------------------------
// Business analysis artifact types.
//
// These mirror the `WorkflowStudioDemoV11` contract produced by the BA Studio
// gatekeeper (packages/custom-gatekeeper/src/types.d.ts). They are kept as a
// local, self-contained shape rather than importing across the workspace
// boundary, since Workflow Studio (a Workshop-owned route) does not hold a
// direct RPC session to a gatekeeper singleton -- only agent-run code reads
// gatekeeper capabilities (see AGENTS.md's ambient gatekeeper binding model).
// Once a supported bridge exists for the agent to publish a validated bundle
// to this viewer, this local fixture should be replaced by that live payload.
// ---------------------------------------------------------------------------

type RequirementPriority = 'must' | 'should' | 'could' | 'wont'

type Requirement = {
  id: string
  title: string
  category: 'functional' | 'nonFunctional' | 'data' | 'integration' | 'compliance' | 'reporting'
  statement: string
  acceptanceCriteria: string[]
  priority: RequirementPriority
  ownerStakeholderId: string
  fitCriterion: string
  benefitHypothesis: string
}

type RaciAssignment = {
  activityId: string
  responsible: string[]
  accountable: string
  consulted: string[]
  informed: string[]
}

type DecisionLogEntry = {
  id: string
  summary: string
  rationale: string
  requirementIds: string[]
  ownerStakeholderId: string
  status: 'proposed' | 'approved' | 'rejected' | 'superseded'
}

type Conflict = {
  id: string
  summary: string
  requirementIds: string[]
  stakeholderIds: string[]
  impact: 'scope' | 'cost' | 'timeline' | 'risk' | 'compliance'
  resolutionOwnerStakeholderId: string
  decision: { status: 'open' | 'inReview' | 'resolved' | 'deferred' | 'rejected' }
}

type TradeoffOption = {
  id: string
  title: string
  summary: string
  scores: { userValue: number; deliveryEffort: number; operationalRisk: number; complianceFit: number }
  impacts: { scope: string; cost: string; timeline: string; risk: string }
}

type SignoffApprover = {
  stakeholderId: string
  role: string
  decision: 'approved' | 'approvedWithConditions' | 'rejected'
  note?: string
}

type Stakeholder = { id: string; name: string; role: string }

const DEMO = {
  contractVersion: 'workflow-studio-demo/v1.1',
  processName: 'Customer onboarding and risk review',
  processId: 'proc-onboarding-001',
  stakeholders: [
    { id: 'st-sales', name: 'Sales Operations', role: 'process-owner' },
    { id: 'st-risk', name: 'Risk and Compliance', role: 'approver' },
    { id: 'st-tech', name: 'Platform Engineering', role: 'delivery-lead' },
  ] satisfies Stakeholder[],
  requirements: [
    {
      id: 'req-capture',
      title: 'Capture onboarding request',
      category: 'functional',
      statement: 'Capture onboarding details from CRM and intake form.',
      acceptanceCriteria: ['Request is persisted with unique ID', 'Requester is authenticated'],
      priority: 'must',
      ownerStakeholderId: 'st-sales',
      fitCriterion: '95% of onboarding requests captured without manual re-entry.',
      benefitHypothesis: 'Reduce intake cycle time and admin errors.',
    },
    {
      id: 'req-risk-check',
      title: 'Run risk triage decision',
      category: 'compliance',
      statement: 'Route high-risk customers to manual review and evidence capture.',
      acceptanceCriteria: ['Risk threshold applied', 'Manual review decision stored'],
      priority: 'must',
      ownerStakeholderId: 'st-risk',
      fitCriterion: '100% of high-risk customers receive manual review.',
      benefitHypothesis: 'Reduce compliance incidents in onboarding.',
    },
  ] satisfies Requirement[],
  raci: [
    { activityId: 'act-intake', responsible: ['st-sales'], accountable: 'st-tech', consulted: ['st-risk'], informed: ['st-sales'] },
    { activityId: 'act-risk-review', responsible: ['st-risk'], accountable: 'st-risk', consulted: ['st-tech'], informed: ['st-sales'] },
  ] satisfies RaciAssignment[],
  decisionLog: [
    {
      id: 'dec-routing-model',
      summary: 'Adopt risk-based branch instead of universal manual review.',
      rationale: 'Balances speed with mandatory control points.',
      requirementIds: ['req-capture', 'req-risk-check'],
      ownerStakeholderId: 'st-risk',
      status: 'approved',
    },
  ] satisfies DecisionLogEntry[],
  conflicts: [
    {
      id: 'conf-sla-vs-control',
      summary: 'Sales requests same-day turnaround; risk requires manual review for high-risk.',
      requirementIds: ['req-capture', 'req-risk-check'],
      stakeholderIds: ['st-sales', 'st-risk'],
      impact: 'timeline',
      resolutionOwnerStakeholderId: 'st-risk',
      decision: { status: 'resolved' },
    },
  ] satisfies Conflict[],
  tradeoffOptions: [
    {
      id: 'opt-speed',
      title: 'Speed-first onboarding',
      summary: 'Minimize checks to maximize conversion.',
      scores: { userValue: 5, deliveryEffort: 2, operationalRisk: 2, complianceFit: 2 },
      impacts: { scope: 'low', cost: 'low', timeline: 'low', risk: 'high' },
    },
    {
      id: 'opt-balanced',
      title: 'Risk-balanced onboarding',
      summary: 'Use risk threshold to trigger targeted manual checks.',
      scores: { userValue: 4, deliveryEffort: 3, operationalRisk: 4, complianceFit: 5 },
      impacts: { scope: 'medium', cost: 'medium', timeline: 'medium', risk: 'low' },
    },
  ] satisfies TradeoffOption[],
  signoff: {
    baselineVersion: 'baseline-2026-08-13-a',
    approvedAt: '2026-08-13T00:00:00.000Z',
    approvers: [
      { stakeholderId: 'st-risk', role: 'Risk Owner', decision: 'approved' },
      {
        stakeholderId: 'st-tech',
        role: 'Platform Engineering Lead',
        decision: 'approvedWithConditions',
        note: 'Monitor review SLA weekly for first month.',
      },
    ] satisfies SignoffApprover[],
  },
  nodes: [
    {
      id: 'n-start',
      type: 'workflow',
      position: { x: 80, y: 70 },
      data: { label: 'Onboarding request received', kind: 'trigger', lane: 'Sales' },
    },
    {
      id: 'n-capture',
      type: 'workflow',
      position: { x: 380, y: 70 },
      data: { label: 'Capture request', kind: 'task', lane: 'Sales', slaHours: 2 },
    },
    {
      id: 'n-risk',
      type: 'workflow',
      position: { x: 700, y: 220 },
      data: { label: 'High-risk customer?', kind: 'decision', lane: 'Risk' },
    },
    {
      id: 'n-fast',
      type: 'workflow',
      position: { x: 980, y: 380 },
      data: { label: 'Auto approve onboarding', kind: 'task', lane: 'Operations/Tech', slaHours: 1 },
    },
    {
      id: 'n-review',
      type: 'workflow',
      position: { x: 980, y: 220 },
      data: { label: 'Manual risk review', kind: 'approval', lane: 'Risk', slaHours: 8 },
    },
    {
      id: 'n-end',
      type: 'workflow',
      position: { x: 1280, y: 380 },
      data: { label: 'Onboarding complete', kind: 'end', lane: 'Operations/Tech' },
    },
  ] satisfies Node<WorkflowNodeData>[],
  edges: [
    { id: 'e-1', source: 'n-start', target: 'n-capture' },
    { id: 'e-2', source: 'n-capture', target: 'n-risk' },
    { id: 'e-3', source: 'n-risk', target: 'n-fast', label: 'no' },
    { id: 'e-4', source: 'n-risk', target: 'n-review', label: 'yes' },
    { id: 'e-5', source: 'n-fast', target: 'n-end' },
    { id: 'e-6', source: 'n-review', target: 'n-end' },
  ] satisfies Edge[],
  selectedRequirementId: 'req-risk-check',
  highlightedConflictId: 'conf-sla-vs-control',
  highlightedTradeoffOptionId: 'opt-balanced',
} as const

function stakeholderName(id: string): string {
  return DEMO.stakeholders.find((s) => s.id === id)?.name ?? id
}

const priorityColor: Record<RequirementPriority, string> = {
  must: 'bg-rose-400/15 text-rose-200',
  should: 'bg-amber-400/15 text-amber-200',
  could: 'bg-sky-400/15 text-sky-200',
  wont: 'bg-kumo-line/40 text-kumo-inactive',
}

const decisionColor: Record<SignoffApprover['decision'], string> = {
  approved: 'bg-emerald-400/15 text-emerald-200',
  approvedWithConditions: 'bg-amber-400/15 text-amber-200',
  rejected: 'bg-rose-400/15 text-rose-200',
}

const conflictStatusColor: Record<Conflict['decision']['status'], string> = {
  open: 'bg-rose-400/15 text-rose-200',
  inReview: 'bg-amber-400/15 text-amber-200',
  resolved: 'bg-emerald-400/15 text-emerald-200',
  deferred: 'bg-kumo-line/40 text-kumo-inactive',
  rejected: 'bg-rose-400/15 text-rose-200',
}

const laneColorByKind: Record<WorkflowNodeKind, string> = {
  trigger: 'bg-emerald-400/15 text-emerald-200',
  task: 'bg-sky-400/15 text-sky-200',
  decision: 'bg-amber-400/15 text-amber-200',
  approval: 'bg-violet-400/15 text-violet-200',
  end: 'bg-rose-400/15 text-rose-200',
}

type ArtifactTab = 'requirements' | 'conflicts' | 'tradeoffs' | 'signoff'

const ARTIFACT_TABS: Array<{ id: ArtifactTab; label: string }> = [
  { id: 'requirements', label: 'Requirements & RACI' },
  { id: 'conflicts', label: 'Conflict register' },
  { id: 'tradeoffs', label: 'Trade-off comparison' },
  { id: 'signoff', label: 'Sign-off packet' },
]

const WorkflowNode = memo(function WorkflowNode({ data }: NodeProps<Node<WorkflowNodeData>>) {
  return (
    <div className="min-w-[210px] rounded-xl border border-kumo-line bg-[#0f172a] px-3 py-2 shadow-[0_10px_25px_rgba(0,0,0,0.35)]">
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-none !bg-kumo-subtle" />
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${laneColorByKind[data.kind]}`}>
          {data.kind}
        </span>
        {data.slaHours !== undefined && <span className="text-[10px] text-kumo-subtle">SLA {data.slaHours}h</span>}
      </div>
      <p className="mt-1 text-[12px] font-medium leading-4 text-kumo-default">{data.label}</p>
      <p className="mt-1 text-[10px] text-kumo-subtle">{data.lane}</p>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-none !bg-kumo-subtle" />
    </div>
  )
})

export const Route = createFileRoute('/workflow-studio')({
  component: WorkflowStudioRoutePage,
})

function WorkflowStudioRoutePage() {
  useDocumentTitle('Workflow Studio')

  const initialNodes = useMemo(() => DEMO.nodes.map((node) => ({ ...node, draggable: true })), [])
  const initialEdges = useMemo(
    () =>
      DEMO.edges.map((edge) => ({
        ...edge,
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 1.8 },
        labelStyle: { fill: '#94a3b8', fontSize: 11 },
      })),
    [],
  )
  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((existingEdges) => addEdge({ ...connection, markerEnd: { type: MarkerType.ArrowClosed } }, existingEdges)),
    [setEdges],
  )
  const nodeTypes = useMemo(() => ({ workflow: WorkflowNode }), [])

  return (
    <div className="mx-auto flex w-full max-w-[1560px] flex-col gap-6 px-6 py-8 sm:px-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-kumo-default">Workflow Studio (interactive)</h1>
        <p className="text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle">
          n8n-style node graph UX using a production flow module stack (drag, connect, pan, zoom, mini-map, controls).
        </p>
        <p className="text-[12px] text-kumo-inactive">
          Contract: {DEMO.contractVersion} · Process: {DEMO.processName} ({DEMO.processId})
        </p>
      </header>

      <section className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-3">
        <article className="rounded-xl border border-kumo-line bg-kumo-elevated p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium text-kumo-default">Workflow graph canvas</h2>
          <div className="h-[620px] overflow-hidden rounded-lg border border-kumo-line/70 bg-kumo-base">
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                fitView
                minZoom={0.4}
                maxZoom={1.8}
                fitViewOptions={{ padding: 0.2 }}
                defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
              >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} />
                <MiniMap pannable zoomable />
                <Controls showInteractive />
                <Panel position="top-left">
                  <div className="rounded-lg border border-kumo-line bg-[#0f172a]/95 px-3 py-2 text-[11px] text-kumo-subtle">
                    Drag nodes · Connect handles · Scroll/trackpad to zoom
                  </div>
                </Panel>
              </ReactFlow>
            </ReactFlowProvider>
          </div>
        </article>

        <article className="space-y-4 rounded-xl border border-kumo-line bg-kumo-elevated p-4">
          <section>
            <h2 className="mb-3 text-sm font-medium text-kumo-default">Viewer focus</h2>
            <dl className="space-y-2 text-[12px]">
              <div>
                <dt className="text-kumo-inactive">Selected requirement</dt>
                <dd className="text-kumo-default">
                  {DEMO.requirements.find((r) => r.id === DEMO.selectedRequirementId)?.title ?? DEMO.selectedRequirementId}
                </dd>
              </div>
              <div>
                <dt className="text-kumo-inactive">Highlighted conflict</dt>
                <dd className="text-kumo-default">
                  {DEMO.conflicts.find((c) => c.id === DEMO.highlightedConflictId)?.summary ?? DEMO.highlightedConflictId}
                </dd>
              </div>
              <div>
                <dt className="text-kumo-inactive">Chosen trade-off option</dt>
                <dd className="text-kumo-default">
                  {DEMO.tradeoffOptions.find((o) => o.id === DEMO.highlightedTradeoffOptionId)?.title ??
                    DEMO.highlightedTradeoffOptionId}
                </dd>
              </div>
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-kumo-inactive">Stakeholders</h3>
            <ul className="space-y-1.5 text-[12px]">
              {DEMO.stakeholders.map((stakeholder) => (
                <li key={stakeholder.id} className="flex items-center justify-between rounded-lg border border-kumo-line/70 bg-kumo-base px-3 py-1.5">
                  <span className="text-kumo-default">{stakeholder.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-kumo-inactive">{stakeholder.role}</span>
                </li>
              ))}
            </ul>
          </section>
        </article>
      </section>

      <ArtifactPanels />
    </div>
  )
}

/**
 * Renders the BA Studio artifact bundle (requirements/RACI, conflicts,
 * trade-offs, sign-off) that a process-discovery interview produces, so the
 * same viewer that renders the process graph also carries the solution
 * architecture's supporting evidence and governance trail.
 */
function ArtifactPanels() {
  const [activeTab, setActiveTab] = useState<ArtifactTab>('requirements')

  return (
    <section className="rounded-xl border border-kumo-line bg-kumo-elevated p-4">
      <div className="mb-4 flex flex-wrap gap-2">
        {ARTIFACT_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-sky-400/20 text-sky-200'
                : 'bg-kumo-base text-kumo-subtle hover:text-kumo-default'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'requirements' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-kumo-inactive">Requirements</h3>
            {DEMO.requirements.map((req) => (
              <div key={req.id} className="rounded-lg border border-kumo-line/70 bg-kumo-base p-3 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-kumo-default">{req.title}</p>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${priorityColor[req.priority]}`}>
                    {req.priority}
                  </span>
                </div>
                <p className="mt-1 text-kumo-subtle">{req.statement}</p>
                <p className="mt-1 text-[10px] text-kumo-inactive">Owner: {stakeholderName(req.ownerStakeholderId)}</p>
                <p className="mt-1 text-[10px] text-kumo-inactive">Fit criterion: {req.fitCriterion}</p>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-kumo-inactive">RACI</h3>
            {DEMO.raci.map((entry) => (
              <div key={entry.activityId} className="rounded-lg border border-kumo-line/70 bg-kumo-base p-3 text-[12px]">
                <p className="font-medium text-kumo-default">{entry.activityId}</p>
                <p className="mt-1 text-kumo-subtle">Responsible: {entry.responsible.map(stakeholderName).join(', ')}</p>
                <p className="text-kumo-subtle">Accountable: {stakeholderName(entry.accountable)}</p>
                <p className="text-kumo-subtle">Consulted: {entry.consulted.map(stakeholderName).join(', ') || '—'}</p>
                <p className="text-kumo-subtle">Informed: {entry.informed.map(stakeholderName).join(', ') || '—'}</p>
              </div>
            ))}
            <h3 className="text-xs font-medium uppercase tracking-wide text-kumo-inactive">Decision log</h3>
            {DEMO.decisionLog.map((decision) => (
              <div key={decision.id} className="rounded-lg border border-kumo-line/70 bg-kumo-base p-3 text-[12px]">
                <p className="font-medium text-kumo-default">{decision.summary}</p>
                <p className="mt-1 text-kumo-subtle">{decision.rationale}</p>
                <p className="mt-1 text-[10px] text-kumo-inactive">
                  Owner: {stakeholderName(decision.ownerStakeholderId)} · Status: {decision.status}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'conflicts' && (
        <div className="space-y-3">
          {DEMO.conflicts.map((conflict) => (
            <div key={conflict.id} className="rounded-lg border border-kumo-line/70 bg-kumo-base p-3 text-[12px]">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-kumo-default">{conflict.summary}</p>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${conflictStatusColor[conflict.decision.status]}`}>
                  {conflict.decision.status}
                </span>
              </div>
              <p className="mt-1 text-kumo-subtle">Impact: {conflict.impact}</p>
              <p className="mt-1 text-kumo-subtle">Stakeholders: {conflict.stakeholderIds.map(stakeholderName).join(', ')}</p>
              <p className="mt-1 text-[10px] text-kumo-inactive">
                Resolution owner: {stakeholderName(conflict.resolutionOwnerStakeholderId)}
              </p>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'tradeoffs' && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[12px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-kumo-inactive">
                <th className="pb-2 pr-3">Option</th>
                <th className="pb-2 pr-3">User value</th>
                <th className="pb-2 pr-3">Delivery effort</th>
                <th className="pb-2 pr-3">Operational risk</th>
                <th className="pb-2 pr-3">Compliance fit</th>
              </tr>
            </thead>
            <tbody>
              {DEMO.tradeoffOptions.map((option) => (
                <tr
                  key={option.id}
                  className={`border-t border-kumo-line/70 ${option.id === DEMO.highlightedTradeoffOptionId ? 'bg-sky-400/10' : ''}`}
                >
                  <td className="py-2 pr-3">
                    <p className="font-medium text-kumo-default">{option.title}</p>
                    <p className="text-[10px] text-kumo-inactive">{option.summary}</p>
                  </td>
                  <td className="py-2 pr-3 text-kumo-subtle">{option.scores.userValue}/5</td>
                  <td className="py-2 pr-3 text-kumo-subtle">{option.scores.deliveryEffort}/5</td>
                  <td className="py-2 pr-3 text-kumo-subtle">{option.scores.operationalRisk}/5</td>
                  <td className="py-2 pr-3 text-kumo-subtle">{option.scores.complianceFit}/5</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'signoff' && (
        <div className="space-y-3">
          <p className="text-[12px] text-kumo-subtle">
            Baseline {DEMO.signoff.baselineVersion} · approved {new Date(DEMO.signoff.approvedAt).toLocaleDateString()}
          </p>
          {DEMO.signoff.approvers.map((approver) => (
            <div key={approver.stakeholderId} className="rounded-lg border border-kumo-line/70 bg-kumo-base p-3 text-[12px]">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-kumo-default">
                  {stakeholderName(approver.stakeholderId)} — {approver.role}
                </p>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${decisionColor[approver.decision]}`}>
                  {approver.decision}
                </span>
              </div>
              {approver.note && <p className="mt-1 text-kumo-subtle">{approver.note}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
