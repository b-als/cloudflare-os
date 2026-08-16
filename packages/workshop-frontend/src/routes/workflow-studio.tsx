import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  type Connection,
  type Edge,
  type EdgeChange,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import { createFileRoute } from '@tanstack/react-router'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RpcStub, RpcTarget } from 'capnweb'
import type { GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import { useAuthenticatedApi } from '../AuthContext'
import { useDocumentTitle } from '../useDocumentTitle'
import { reportIssue } from '../errorReporting'
import '@xyflow/react/dist/style.css'

type WorkflowNodeKind = 'trigger' | 'task' | 'decision' | 'integration' | 'approval' | 'end'

type WorkflowNodeData = {
  label: string
  kind: WorkflowNodeKind
  lane: string
  slaHours?: number
}

type RequirementPriority = 'must' | 'should' | 'could' | 'wont'

type Stakeholder = { id: string; name: string; role: string }

type Requirement = {
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

type StakeholderSuggestion = {
  id: string
  name?: string
  role: string
  reason: string
  source: 'interview' | 'gapAnalysis'
  suggestedAt: string
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
  impacts: { scope: 'low' | 'medium' | 'high'; cost: 'low' | 'medium' | 'high'; timeline: 'low' | 'medium' | 'high'; risk: 'low' | 'medium' | 'high' }
}

type SignoffApprover = {
  stakeholderId: string
  role: string
  decision: 'approved' | 'approvedWithConditions' | 'rejected'
  note?: string
}

type WorkflowStudioDemoV11 = {
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

type BaProjectRecord = {
  processId: string
  version: number
  updatedAt: string
  bundle: WorkflowStudioDemoV11
}

type WorkflowStepRecordV1 = {
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

type WorkflowRunRecordV1 = {
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

interface BaUiApi extends RpcTarget {
  getProject(processId: string): Promise<BaProjectRecord | null>
  saveProject(processId: string, bundle: WorkflowStudioDemoV11): Promise<BaProjectRecord>
  getStakeholderSuggestions(bundle: WorkflowStudioDemoV11): Promise<StakeholderSuggestion[]>
  createStarterBundle(processId: string, processName: string): Promise<WorkflowStudioDemoV11>
  startWorkflowRun(processId: string, note?: string): Promise<WorkflowRunRecordV1>
  advanceWorkflowRun(
    processId: string,
    runId: string,
    input: { condition?: string; approvalDecision?: 'approved' | 'rejected'; note?: string },
  ): Promise<WorkflowRunRecordV1>
  getWorkflowRun(processId: string, runId: string): Promise<WorkflowRunRecordV1 | null>
  listWorkflowRuns(processId: string): Promise<WorkflowRunRecordV1[]>
}

type ArtifactTab = 'requirements' | 'conflicts' | 'tradeoffs' | 'signoff'

const BA_STUDIO_APP_ID = 'custom'
const DEFAULT_PROCESS_ID = 'proc-onboarding-001'

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
  integration: 'bg-cyan-400/15 text-cyan-200',
  approval: 'bg-violet-400/15 text-violet-200',
  end: 'bg-rose-400/15 text-rose-200',
}

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

function disposeFrame(frame: GatekeeperUiFrame | null) {
  ;(frame?.ui as { [Symbol.dispose]?(): void } | undefined)?.[Symbol.dispose]?.()
}

function toFlowNodes(bundle: WorkflowStudioDemoV11): Node<WorkflowNodeData>[] {
  return bundle.processGraph.nodes.map((node, index) => ({
    id: node.id,
    type: 'workflow',
    position: { x: 80 + (index % 4) * 300, y: 80 + Math.floor(index / 4) * 160 },
    data: {
      label: node.label,
      kind: node.type,
      lane: stakeholderName(bundle, node.swimlaneStakeholderId) ?? 'Unassigned',
      slaHours: node.slaHours,
    },
    draggable: true,
  }))
}

function toFlowEdges(bundle: WorkflowStudioDemoV11): Edge[] {
  return bundle.processGraph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.condition,
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { strokeWidth: 1.8 },
    labelStyle: { fill: '#94a3b8', fontSize: 11 },
  }))
}

function stakeholderName(bundle: WorkflowStudioDemoV11 | null, id?: string): string | null {
  if (!bundle || !id) return null
  return bundle.requirements.stakeholders.find((s) => s.id === id)?.name ?? id
}

export const Route = createFileRoute('/workflow-studio')({
  component: WorkflowStudioRoutePage,
})

function WorkflowStudioRoutePage() {
  useDocumentTitle('Workflow Studio')
  const { authenticatedApi } = useAuthenticatedApi()
  const [processId, setProcessId] = useState(DEFAULT_PROCESS_ID)
  const [processInput, setProcessInput] = useState(DEFAULT_PROCESS_ID)
  const [frameState, setFrameState] = useState<{ frame: GatekeeperUiFrame } | null>(null)
  const [bundle, setBundle] = useState<WorkflowStudioDemoV11 | null>(null)
  const [record, setRecord] = useState<BaProjectRecord | null>(null)
  const [suggestions, setSuggestions] = useState<StakeholderSuggestion[]>([])
  const [runs, setRuns] = useState<WorkflowRunRecordV1[]>([])
  const [activeRun, setActiveRun] = useState<WorkflowRunRecordV1 | null>(null)
  const [runNote, setRunNote] = useState('')
  const [decisionCondition, setDecisionCondition] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('Loading BA Studio project…')
  const [artifactTab, setArtifactTab] = useState<ArtifactTab>('requirements')
  const [nodes, setNodes] = useState<Node<WorkflowNodeData>[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const saveTimeoutRef = useRef<number | null>(null)
  const skipAutosaveRef = useRef(true)
  const nodeTypes = useMemo(() => ({ workflow: WorkflowNode }), [])

  const ui = frameState?.frame.ui as RpcStub<BaUiApi> | undefined

  const loadRuns = useCallback(
    async (api: RpcStub<BaUiApi>, currentProcessId: string) => {
      const list = await api.listWorkflowRuns(currentProcessId)
      setRuns(list)
      setActiveRun(list[0] ?? null)
    },
    [],
  )

  const loadProject = useCallback(
    async (api: RpcStub<BaUiApi>, currentProcessId: string) => {
      setLoading(true)
      setError(null)
      setStatus('Loading BA Studio project…')
      try {
        const existing = await api.getProject(currentProcessId)
        const activeBundle = existing
          ? existing.bundle
          : await api.createStarterBundle(currentProcessId, 'Customer onboarding and risk review')
        setProcessId(currentProcessId)
        setProcessInput(currentProcessId)
        setRecord(existing)
        setBundle(activeBundle)
        setNodes(toFlowNodes(activeBundle))
        setEdges(toFlowEdges(activeBundle))
        setSuggestions(await api.getStakeholderSuggestions(activeBundle))
        await loadRuns(api, currentProcessId)
        setStatus(
          existing
            ? `Loaded v${existing.version} · saved ${new Date(existing.updatedAt).toLocaleString()}`
            : 'Loaded starter bundle. Save layout to persist this project.',
        )
        skipAutosaveRef.current = true
      } catch (err) {
        console.error('Failed to load workflow studio project:', err)
        reportIssue('workflow-studio.load', err, { gatekeeperVendorId: BA_STUDIO_APP_ID })
        setError(`${err}`)
      } finally {
        setLoading(false)
      }
    },
    [loadRuns],
  )

  useEffect(() => {
    let cancelled = false
    let acquired: GatekeeperUiFrame | null = null
    // The BA Studio gatekeeper is an ambient ("optional") vendor: it auto-provisions an account
    // on demand rather than being force-enabled for every user, so a fresh user has no account
    // for it yet and getGatekeeperApp() returns null. Provision it explicitly (idempotent) before
    // giving up, mirroring the Connectors page's "Add" flow (see routes/gatekeepers.tsx).
    authenticatedApi
      .getGatekeeperApp(BA_STUDIO_APP_ID)
      .then(async (frame) => {
        if (frame) return frame
        await authenticatedApi.provisionAmbientAccount(BA_STUDIO_APP_ID)
        return authenticatedApi.getGatekeeperApp(BA_STUDIO_APP_ID)
      })
      .then((frame) => {
        if (!frame) {
          if (!cancelled) setError('BA Studio gatekeeper app is not available on this deployment.')
          return
        }
        if (cancelled) {
          disposeFrame(frame)
          return
        }
        acquired = frame
        setFrameState({ frame })
      })
      .catch((err) => {
        console.error('Failed to acquire BA Studio UI capability:', err)
        reportIssue('workflow-studio.acquire-ui', err, { gatekeeperVendorId: BA_STUDIO_APP_ID })
        if (!cancelled) setError(`${err}`)
      })
    return () => {
      cancelled = true
      disposeFrame(acquired)
      if (saveTimeoutRef.current !== null) window.clearTimeout(saveTimeoutRef.current)
    }
  }, [authenticatedApi])

  useEffect(() => {
    if (!ui) return
    void loadProject(ui, DEFAULT_PROCESS_ID)
  }, [ui, loadProject])

  const saveBundle = useCallback(
    async (nextBundle: WorkflowStudioDemoV11, successMessage = 'Saved layout.') => {
      if (!ui) return
      setSaving(true)
      try {
        const saved = await ui.saveProject(processId, nextBundle)
        setRecord(saved)
        setBundle(saved.bundle)
        setSuggestions(await ui.getStakeholderSuggestions(saved.bundle))
        await loadRuns(ui, processId)
        setStatus(`${successMessage} v${saved.version}`)
      } catch (err) {
        console.error('Failed to save workflow studio project:', err)
        reportIssue('workflow-studio.save', err, { gatekeeperVendorId: BA_STUDIO_APP_ID })
        setError(`${err}`)
      } finally {
        setSaving(false)
      }
    },
    [loadRuns, processId, ui],
  )

  const queueGraphSave = useCallback(
    (nextNodes: Node<WorkflowNodeData>[], nextEdges: Edge[]) => {
      if (!bundle) return
      const updatedBundle: WorkflowStudioDemoV11 = {
        ...bundle,
        processGraph: {
          ...bundle.processGraph,
          nodes: nextNodes.map((node) => {
            const current = bundle.processGraph.nodes.find((item) => item.id === node.id)
            return {
              id: node.id,
              type: node.data.kind,
              label: node.data.label,
              swimlaneStakeholderId:
                current?.swimlaneStakeholderId ??
                bundle.requirements.stakeholders.find((stakeholder) => stakeholder.name === node.data.lane)?.id,
              slaHours: node.data.slaHours,
            }
          }),
          edges: nextEdges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            condition: typeof edge.label === 'string' && edge.label.length > 0 ? edge.label : undefined,
          })),
        },
      }
      setBundle(updatedBundle)
      if (saveTimeoutRef.current !== null) window.clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = window.setTimeout(() => {
        void saveBundle(updatedBundle, 'Auto-saved workflow graph.')
      }, 500)
    },
    [bundle, saveBundle],
  )

  useEffect(() => {
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false
      return
    }
    if (!bundle) return
    queueGraphSave(nodes, edges)
  }, [nodes, edges, bundle, queueGraphSave])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes) as Node<WorkflowNodeData>[])
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges))
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    setEdges((currentEdges) =>
      addEdge(
        {
          ...connection,
          id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { strokeWidth: 1.8 },
          labelStyle: { fill: '#94a3b8', fontSize: 11 },
        },
        currentEdges,
      ),
    )
  }, [])

  const pendingNode = useMemo(() => {
    if (!activeRun?.pendingNodeId || !bundle) return null
    return bundle.processGraph.nodes.find((node) => node.id === activeRun.pendingNodeId) ?? null
  }, [activeRun, bundle])

  const pendingEdgeConditions = useMemo(() => {
    if (!pendingNode || !bundle) return []
    return bundle.processGraph.edges
      .filter((edge) => edge.source === pendingNode.id && edge.condition)
      .map((edge) => edge.condition as string)
  }, [bundle, pendingNode])

  const startRun = useCallback(async () => {
    if (!ui) return
    setSaving(true)
    try {
      const run = await ui.startWorkflowRun(processId, runNote.trim() || undefined)
      setRunNote('')
      setActiveRun(run)
      await loadRuns(ui, processId)
      setStatus(`Started run ${run.runId} (${run.status}).`)
    } catch (err) {
      setError(`${err}`)
    } finally {
      setSaving(false)
    }
  }, [loadRuns, processId, runNote, ui])

  const submitApproval = useCallback(
    async (approvalDecision: 'approved' | 'rejected') => {
      if (!ui || !activeRun) return
      setSaving(true)
      try {
        const run = await ui.advanceWorkflowRun(processId, activeRun.runId, { approvalDecision })
        setActiveRun(run)
        await loadRuns(ui, processId)
        setStatus(`Run ${run.runId} is now ${run.status}.`)
      } catch (err) {
        setError(`${err}`)
      } finally {
        setSaving(false)
      }
    },
    [activeRun, loadRuns, processId, ui],
  )

  const submitDecision = useCallback(async () => {
    if (!ui || !activeRun) return
    setSaving(true)
    try {
      const run = await ui.advanceWorkflowRun(processId, activeRun.runId, {
        condition: decisionCondition.trim() || undefined,
      })
      setDecisionCondition('')
      setActiveRun(run)
      await loadRuns(ui, processId)
      setStatus(`Run ${run.runId} is now ${run.status}.`)
    } catch (err) {
      setError(`${err}`)
    } finally {
      setSaving(false)
    }
  }, [activeRun, decisionCondition, loadRuns, processId, ui])

  if (error) {
    return <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-kumo-subtle">{error}</div>
  }

  if (loading || !bundle) {
    return <div className="px-4 py-16 text-center text-sm text-kumo-subtle">Loading…</div>
  }

  return (
    <div className="mx-auto flex w-full max-w-[1560px] flex-col gap-6 px-6 py-8 sm:px-10">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-kumo-default">Workflow Studio (interactive)</h1>
            <p className="text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle">
              Live BA Studio data loaded via the trusted gatekeeper UI RPC capability.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={processInput}
              onChange={(event) => setProcessInput(event.target.value)}
              className="rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-[12px] text-kumo-default"
            />
            <button
              type="button"
              onClick={() => {
                if (ui) void loadProject(ui, processInput.trim() || DEFAULT_PROCESS_ID)
              }}
              className="rounded-lg bg-kumo-base px-3 py-2 text-[12px] text-kumo-default"
            >
              Load
            </button>
            <button
              type="button"
              onClick={() => void saveBundle(bundle, 'Saved project.')}
              className="rounded-lg bg-sky-400/20 px-3 py-2 text-[12px] text-sky-200"
              disabled={saving}
            >
              Save layout
            </button>
          </div>
        </div>
        <p className="text-[12px] text-kumo-inactive">
          Contract: {bundle.contractVersion} · Process: {bundle.processName} ({processId})
          {record ? ` · v${record.version}` : ' · starter bundle'}
        </p>
        <p className="text-[12px] text-kumo-subtle">{status}</p>
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
                    Drag nodes · Connect handles · Layout auto-saves after graph changes
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
                  {bundle.requirements.requirements.find((r) => r.id === bundle.viewer.selectedRequirementId)?.title ??
                    bundle.viewer.selectedRequirementId}
                </dd>
              </div>
              <div>
                <dt className="text-kumo-inactive">Highlighted conflict</dt>
                <dd className="text-kumo-default">
                  {bundle.conflictRegister.conflicts.find((c) => c.id === bundle.viewer.highlightedConflictId)?.summary ??
                    bundle.viewer.highlightedConflictId}
                </dd>
              </div>
              <div>
                <dt className="text-kumo-inactive">Chosen trade-off option</dt>
                <dd className="text-kumo-default">
                  {bundle.tradeoffRegister.options.find((o) => o.id === bundle.viewer.highlightedTradeoffOptionId)?.title ??
                    bundle.viewer.highlightedTradeoffOptionId}
                </dd>
              </div>
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-kumo-inactive">Stakeholders</h3>
            <ul className="space-y-1.5 text-[12px]">
              {bundle.requirements.stakeholders.map((stakeholder) => (
                <li key={stakeholder.id} className="flex items-center justify-between rounded-lg border border-kumo-line/70 bg-kumo-base px-3 py-1.5">
                  <span className="text-kumo-default">{stakeholder.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-kumo-inactive">{stakeholder.role}</span>
                </li>
              ))}
            </ul>
          </section>

          {suggestions.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-kumo-inactive">Suggestions</h3>
              <div className="space-y-2">
                {suggestions.map((suggestion) => (
                  <div key={suggestion.id} className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-[12px]">
                    <p className="font-medium text-kumo-default">
                      {suggestion.name ? `${suggestion.name} · ` : ''}
                      {suggestion.role}
                    </p>
                    <p className="mt-1 text-kumo-subtle">{suggestion.reason}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-kumo-inactive">Workflow runs</h3>
            <div className="space-y-3 rounded-lg border border-kumo-line/70 bg-kumo-base p-3 text-[12px]">
              <div className="flex gap-2">
                <input
                  value={runNote}
                  onChange={(event) => setRunNote(event.target.value)}
                  placeholder="Optional note for this run"
                  className="flex-1 rounded border border-kumo-line/70 bg-transparent px-2 py-1 text-kumo-default"
                />
                <button
                  type="button"
                  onClick={() => void startRun()}
                  disabled={saving || !record}
                  className="rounded bg-emerald-400/20 px-3 py-1.5 text-emerald-200 disabled:opacity-50"
                >
                  Start run
                </button>
              </div>
              {!record && <p className="text-kumo-inactive">Save the project before starting a run.</p>}

              {activeRun && (
                <div className="space-y-3">
                  <p className="text-kumo-default">
                    <code>{activeRun.runId}</code> · <strong>{activeRun.status}</strong>
                  </p>
                  <ul className="space-y-1 text-kumo-subtle">
                    {activeRun.steps.map((step) => (
                      <li key={`${activeRun.runId}-${step.nodeId}-${step.enteredAt}`}>
                        {step.label} ({step.type}) — {step.status}
                        {step.chosenCondition ? ` — chose "${step.chosenCondition}"` : ''}
                        {step.approvalDecision ? ` — ${step.approvalDecision}` : ''}
                      </li>
                    ))}
                  </ul>

                  {activeRun.status === 'waitingForInput' && pendingNode?.type === 'approval' && (
                    <div className="space-y-2">
                      <p className="font-medium text-kumo-default">Awaiting approval: {pendingNode.label}</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void submitApproval('approved')}
                          className="rounded bg-emerald-400/20 px-3 py-1.5 text-emerald-200"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => void submitApproval('rejected')}
                          className="rounded bg-rose-400/20 px-3 py-1.5 text-rose-200"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}

                  {activeRun.status === 'waitingForInput' && pendingNode?.type === 'decision' && (
                    <div className="space-y-2">
                      <p className="font-medium text-kumo-default">Awaiting decision: {pendingNode.label}</p>
                      <div className="flex gap-2">
                        <select
                          value={decisionCondition}
                          onChange={(event) => setDecisionCondition(event.target.value)}
                          className="flex-1 rounded border border-kumo-line/70 bg-transparent px-2 py-1 text-kumo-default"
                        >
                          <option value="">Choose branch…</option>
                          {pendingEdgeConditions.map((condition) => (
                            <option key={condition} value={condition}>
                              {condition}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void submitDecision()}
                          className="rounded bg-sky-400/20 px-3 py-1.5 text-sky-200"
                        >
                          Confirm
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {runs.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-kumo-default">Run history ({runs.length})</summary>
                  <ul className="mt-2 space-y-1 text-kumo-subtle">
                    {runs.map((run) => (
                      <li key={run.runId}>
                        <button
                          type="button"
                          onClick={() => setActiveRun(run)}
                          className="text-left underline"
                        >
                          {run.runId}
                        </button>{' '}
                        — {run.status} — started {new Date(run.startedAt).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </section>
        </article>
      </section>

      <section className="rounded-xl border border-kumo-line bg-kumo-elevated p-4">
        <div className="mb-4 flex flex-wrap gap-2">
          {ARTIFACT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setArtifactTab(tab.id)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                artifactTab === tab.id ? 'bg-sky-400/20 text-sky-200' : 'bg-kumo-base text-kumo-subtle hover:text-kumo-default'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {artifactTab === 'requirements' && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-kumo-inactive">Requirements</h3>
              {bundle.requirements.requirements.map((req) => (
                <div key={req.id} className="rounded-lg border border-kumo-line/70 bg-kumo-base p-3 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-kumo-default">{req.title}</p>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${priorityColor[req.priority]}`}>
                      {req.priority}
                    </span>
                  </div>
                  <p className="mt-1 text-kumo-subtle">{req.statement}</p>
                  <p className="mt-1 text-[10px] text-kumo-inactive">Owner: {stakeholderName(bundle, req.ownerStakeholderId)}</p>
                  <p className="mt-1 text-[10px] text-kumo-inactive">Fit criterion: {req.fitCriterion || '—'}</p>
                </div>
              ))}
            </div>
            <div className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-kumo-inactive">RACI</h3>
              {bundle.requirements.raci.map((entry) => (
                <div key={entry.activityId} className="rounded-lg border border-kumo-line/70 bg-kumo-base p-3 text-[12px]">
                  <p className="font-medium text-kumo-default">{entry.activityId}</p>
                  <p className="mt-1 text-kumo-subtle">Responsible: {entry.responsible.map((id) => stakeholderName(bundle, id)).join(', ') || '—'}</p>
                  <p className="text-kumo-subtle">Accountable: {stakeholderName(bundle, entry.accountable) ?? '—'}</p>
                  <p className="text-kumo-subtle">Consulted: {entry.consulted.map((id) => stakeholderName(bundle, id)).join(', ') || '—'}</p>
                  <p className="text-kumo-subtle">Informed: {entry.informed.map((id) => stakeholderName(bundle, id)).join(', ') || '—'}</p>
                </div>
              ))}
              <h3 className="text-xs font-medium uppercase tracking-wide text-kumo-inactive">Decision log</h3>
              {bundle.requirements.decisionLog.map((decision) => (
                <div key={decision.id} className="rounded-lg border border-kumo-line/70 bg-kumo-base p-3 text-[12px]">
                  <p className="font-medium text-kumo-default">{decision.summary}</p>
                  <p className="mt-1 text-kumo-subtle">{decision.rationale}</p>
                  <p className="mt-1 text-[10px] text-kumo-inactive">
                    Owner: {stakeholderName(bundle, decision.ownerStakeholderId)} · Status: {decision.status}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {artifactTab === 'conflicts' && (
          <div className="space-y-3">
            {bundle.conflictRegister.conflicts.map((conflict) => (
              <div key={conflict.id} className="rounded-lg border border-kumo-line/70 bg-kumo-base p-3 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-kumo-default">{conflict.summary}</p>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${conflictStatusColor[conflict.decision.status]}`}>
                    {conflict.decision.status}
                  </span>
                </div>
                <p className="mt-1 text-kumo-subtle">Impact: {conflict.impact}</p>
                <p className="mt-1 text-kumo-subtle">Stakeholders: {conflict.stakeholderIds.map((id) => stakeholderName(bundle, id)).join(', ') || '—'}</p>
                <p className="mt-1 text-[10px] text-kumo-inactive">
                  Resolution owner: {stakeholderName(bundle, conflict.resolutionOwnerStakeholderId)}
                </p>
              </div>
            ))}
          </div>
        )}

        {artifactTab === 'tradeoffs' && (
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
                {bundle.tradeoffRegister.options.map((option) => (
                  <tr
                    key={option.id}
                    className={`border-t border-kumo-line/70 ${
                      option.id === bundle.tradeoffRegister.preferredOptionId ? 'bg-sky-400/10' : ''
                    }`}
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

        {artifactTab === 'signoff' && (
          <div className="space-y-3">
            <p className="text-[12px] text-kumo-subtle">
              Baseline {bundle.signoffPacket.baselineVersion} · approved{' '}
              {bundle.signoffPacket.approvedAt ? new Date(bundle.signoffPacket.approvedAt).toLocaleDateString() : '—'}
            </p>
            {bundle.signoffPacket.approvers.map((approver) => (
              <div key={`${approver.stakeholderId}-${approver.role}`} className="rounded-lg border border-kumo-line/70 bg-kumo-base p-3 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-kumo-default">
                    {stakeholderName(bundle, approver.stakeholderId)} — {approver.role}
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
    </div>
  )
}
