import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowsClockwise, Clock, Gear, Hand, LockSimple, Plus, Rows, Sparkle, User } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import { useKumoToastManager } from '@cloudflare/kumo'
import type { AiChatAuthorInfo, AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { LANE_HEIGHT, PROCESS_NODE_TYPES } from '@gadgets/gatekeeper-process/graph-ops'
import type {
  Decision,
  GraphOp,
  ProcessGraph,
  ProcessNode,
  ProcessNodeType,
  Takeaway,
  TakeawayInput,
} from '@gadgets/gatekeeper-process/types'
import type { PendingPreview } from '@gadgets/gatekeeper-process/ui-types'
import { useTheme } from '../ThemeContext'
import type { LocalApplyResult } from './opQueue'
import StepDetailsPanel, { type StepDetailPatch } from './StepDetailsPanel'
import '@xyflow/react/dist/style.css'

const LANE_LABEL_WIDTH = 132
const MIN_LANE_WIDTH = 900
const TASK_WIDTH = 152
const TASK_HEIGHT = 60
const EVENT_SIZE = 38
const GATEWAY_SIZE = 42

const NODE_TYPE_LABEL: Record<ProcessNodeType, string> = {
  startEvent: 'Start event',
  endEvent: 'End event',
  timerEvent: 'Timer event',
  userTask: 'User task',
  serviceTask: 'Service task',
  manualTask: 'Manual task',
  exclusiveGateway: 'Exclusive gateway',
  parallelGateway: 'Parallel gateway',
}

const taskIcon: Partial<Record<ProcessNodeType, typeof User>> = { userTask: User, serviceTask: Gear, manualTask: Hand }

type LaneData = { label: string; width: number }
/** How a pending agent proposal, if any, would change this element. */
type PreviewStatus = 'added' | 'changed' | 'removed'
type StepData = {
  node: ProcessNode
  editing: boolean
  locked: boolean
  previewStatus?: PreviewStatus
  onCommit: (id: string, label: string) => void
}

const LaneBand = memo(function LaneBand({ data }: NodeProps<Node<LaneData>>) {
  return (
    <div className="flex border-b border-kumo-line/70" style={{ width: data.width, height: LANE_HEIGHT }}>
      <div
        className="flex shrink-0 items-center border-r border-kumo-line/70 bg-kumo-tint/60 px-3 text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle"
        style={{ width: LANE_LABEL_WIDTH }}
      >
        {data.label}
      </div>
    </div>
  )
})

function LabelEditor({ data, className }: { data: StepData; className: string }) {
  if (!data.editing) return <span className={className}>{data.node.label}</span>
  return (
    <input
      autoFocus
      defaultValue={data.node.label}
      aria-label="Step label"
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => data.onCommit(data.node.id, event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          event.currentTarget.value = data.node.label
          event.currentTarget.blur()
        }
      }}
      className={`nodrag rounded border border-kumo-brand bg-kumo-base px-1 text-kumo-default outline-none ${className}`}
    />
  )
}

const StepNode = memo(function StepNode({ data, selected }: NodeProps<Node<StepData>>) {
  const { node } = data
  const ring = selected ? 'ring-2 ring-kumo-brand ring-offset-2 ring-offset-kumo-base' : ''
  const lockBadge = data.locked && (
    <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-kumo-warning text-white">
      <LockSimple size={9} weight="fill" />
    </span>
  )
  // A pending agent proposal touching this step: ghost new steps, fade removals, ring changes.
  const previewOutline = data.previewStatus && (
    <div
      className={`pointer-events-none absolute -inset-1 rounded-md border-2 border-dashed ${
        data.previewStatus === 'removed' ? 'border-kumo-danger' : 'border-kumo-brand'
      }`}
    />
  )
  const previewBadge = data.previewStatus && data.previewStatus !== 'removed' && (
    <span className="absolute -left-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-kumo-brand text-white">
      <Sparkle size={9} weight="fill" />
    </span>
  )
  const previewOpacity =
    data.previewStatus === 'added' ? 'opacity-60' : data.previewStatus === 'removed' ? 'opacity-40' : ''
  const handles = (
    <>
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-none !bg-kumo-subtle" />
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-none !bg-kumo-subtle" />
    </>
  )
  const caption = (
    <LabelEditor
      data={data}
      className="absolute left-1/2 top-full mt-1 w-[140px] -translate-x-1/2 text-center text-[10.5px] leading-[13px] text-kumo-default"
    />
  )

  if (node.type === 'startEvent' || node.type === 'endEvent' || node.type === 'timerEvent') {
    const border =
      node.type === 'startEvent'
        ? 'border-2 border-emerald-500'
        : node.type === 'endEvent'
          ? 'border-[4px] border-kumo-default'
          : 'border-2 border-double border-amber-500'
    return (
      <div className={`relative ${previewOpacity}`} style={{ width: EVENT_SIZE, height: EVENT_SIZE }}>
        <div className={`flex h-full w-full items-center justify-center rounded-full bg-kumo-base ${border} ${ring}`}>
          {node.type === 'timerEvent' && <Clock size={16} className="text-amber-500" />}
        </div>
        {lockBadge}
        {previewOutline}
        {previewBadge}
        {caption}
        {handles}
      </div>
    )
  }

  if (node.type === 'exclusiveGateway' || node.type === 'parallelGateway') {
    return (
      <div className={`relative ${previewOpacity}`} style={{ width: GATEWAY_SIZE, height: GATEWAY_SIZE }}>
        <div className={`absolute inset-[6px] rotate-45 rounded-[3px] border-2 border-amber-500 bg-kumo-base ${ring}`} />
        <span className="absolute inset-0 flex items-center justify-center text-[15px] font-bold text-amber-500">
          {node.type === 'parallelGateway' ? '+' : '×'}
        </span>
        {lockBadge}
        {previewOutline}
        {previewBadge}
        {caption}
        {handles}
      </div>
    )
  }

  const Icon = taskIcon[node.type] ?? User
  return (
    <div
      className={`relative flex flex-col justify-between rounded-lg border border-kumo-line bg-kumo-base px-2 py-1.5 shadow-sm ${ring} ${previewOpacity}`}
      style={{ width: TASK_WIDTH, height: TASK_HEIGHT }}
    >
      <span className="inline-flex items-center gap-1 text-[10px] text-kumo-subtle">
        <Icon size={11} />
        {NODE_TYPE_LABEL[node.type]}
      </span>
      <LabelEditor data={data} className="line-clamp-2 w-full text-[11px] font-medium leading-[13px] text-kumo-default" />
      {lockBadge}
      {previewOutline}
      {previewBadge}
      {handles}
    </div>
  )
})

const nodeTypes = { lane: LaneBand, step: StepNode }

function stepSize(type: ProcessNodeType): { width: number; height: number } {
  if (type === 'exclusiveGateway' || type === 'parallelGateway') return { width: GATEWAY_SIZE, height: GATEWAY_SIZE }
  if (type === 'startEvent' || type === 'endEvent' || type === 'timerEvent') return { width: EVENT_SIZE, height: EVENT_SIZE }
  return { width: TASK_WIDTH, height: TASK_HEIGHT }
}

function buildNodes(
  graph: ProcessGraph,
  editingId: string | null,
  lockedNodeIds: ReadonlySet<string>,
  onCommit: StepData['onCommit'],
  preview: PendingPreview | null,
): Node[] {
  const width = LANE_LABEL_WIDTH + Math.max(MIN_LANE_WIDTH, ...graph.nodes.map((n) => n.x + TASK_WIDTH + 240))
  const lanes: Node[] = graph.lanes.map((lane, index) => ({
    id: `lane:${lane.id}`,
    type: 'lane',
    position: { x: -LANE_LABEL_WIDTH, y: index * LANE_HEIGHT },
    data: { label: lane.label, width } satisfies LaneData,
    draggable: false,
    selectable: false,
    connectable: false,
    deletable: false,
    zIndex: -1,
  }))
  const removedIds = new Set(preview?.removedNodeIds ?? [])
  const changedIds = new Set(preview?.changedNodeIds ?? [])
  const previewStatus = (id: string): PreviewStatus | undefined =>
    removedIds.has(id) ? 'removed' : changedIds.has(id) ? 'changed' : undefined
  const steps: Node[] = graph.nodes.map((node) => ({
    id: node.id,
    type: 'step',
    position: { x: node.x, y: node.y },
    data: {
      node, editing: editingId === node.id, locked: lockedNodeIds.has(node.id),
      previewStatus: previewStatus(node.id), onCommit,
    } satisfies StepData,
  }))
  // Proposed additions render as ghosts; a proposal that also adds a new lane can't be placed yet.
  const laneIds = new Set(graph.lanes.map((l) => l.id))
  const ghosts: Node[] = (preview?.addedNodes ?? [])
    .filter((node) => laneIds.has(node.laneId))
    .map((node) => ({
      id: node.id,
      type: 'step',
      position: { x: node.x, y: node.y },
      data: { node, editing: false, locked: false, previewStatus: 'added', onCommit } satisfies StepData,
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
    }))
  return [...lanes, ...steps, ...ghosts]
}

function buildEdges(graph: ProcessGraph, lockedEdgeIds: ReadonlySet<string>, preview: PendingPreview | null): Edge[] {
  const removedIds = new Set(preview?.removedEdgeIds ?? [])
  const changedIds = new Set(preview?.changedEdgeIds ?? [])
  const edges: Edge[] = graph.edges.map((edge) => {
    const status: PreviewStatus | undefined = removedIds.has(edge.id)
      ? 'removed'
      : changedIds.has(edge.id) ? 'changed' : undefined
    const style = status === 'removed'
      ? { strokeWidth: 1.5, stroke: 'var(--kumo-danger)', strokeDasharray: '4 3', opacity: 0.5 }
      : status === 'changed'
        ? { strokeWidth: 1.5, stroke: 'var(--kumo-brand)', strokeDasharray: '4 3' }
        : lockedEdgeIds.has(edge.id)
          ? { strokeWidth: 1.5, stroke: 'var(--kumo-warning)', strokeDasharray: '4 3' }
          : { strokeWidth: 1.5 }
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      label: edge.label,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      style,
      labelStyle: { fontSize: 10.5 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
    }
  })
  const ghosts: Edge[] = (preview?.addedEdges ?? []).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    label: edge.label,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: { strokeWidth: 1.5, stroke: 'var(--kumo-brand)', strokeDasharray: '4 3', opacity: 0.6 },
    labelStyle: { fontSize: 10.5 },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 4,
    selectable: false,
  }))
  return [...edges, ...ghosts]
}

// Keeps React Flow's measurements, selection and in-progress drags across graph updates.
function mergeNodes(current: Node[], next: Node[]): Node[] {
  const previous = new Map(current.map((node) => [node.id, node]))
  return next.map((node) => {
    const prior = previous.get(node.id)
    if (!prior) return node
    return { ...node, measured: prior.measured, selected: prior.selected, position: prior.dragging ? prior.position : node.position }
  })
}

function mergeEdges(current: Edge[], next: Edge[]): Edge[] {
  const selected = new Set(current.filter((edge) => edge.selected).map((edge) => edge.id))
  return next.map((edge) => (selected.has(edge.id) ? { ...edge, selected: true } : edge))
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

function LaneInput({ onSubmit, onCancel }: { onSubmit: (label: string) => void; onCancel?: () => void }) {
  const [label, setLabel] = useState('')
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!label.trim()) return
        onSubmit(label.trim())
        setLabel('')
      }}
    >
      <input
        autoFocus
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && onCancel?.()}
        placeholder="Lane name, e.g. Compliance"
        className="h-8 w-52 rounded-lg border border-kumo-line bg-kumo-base px-2.5 text-[12.5px] text-kumo-default outline-none focus:border-kumo-brand"
      />
      <button
        type="submit"
        disabled={!label.trim()}
        className="h-8 rounded-lg bg-kumo-brand px-3 text-[12.5px] font-medium text-white hover:bg-kumo-brand-hover disabled:opacity-60"
      >
        Add lane
      </button>
    </form>
  )
}

const toolbarButton =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-kumo-line bg-kumo-base px-2.5 text-[12.5px] text-kumo-default hover:bg-kumo-tint disabled:opacity-50'

export type ProcessCanvasProps = {
  graph: ProcessGraph
  /** Active decisions; elements they cover (when locked) reject direct edits except moving. */
  decisions: Decision[]
  /** Project takeaways; the selected step shows those linked to its id. */
  takeaways: Takeaway[]
  /** How pending agent proposals would change the graph; ghosted/faded/highlighted on the canvas. */
  pendingPreview: PendingPreview | null
  /** The workspace's collaborators, suggested when filling in a step's owner field. */
  people: AiChatAuthorInfo[]
  authenticatedApi: RpcStub<AuthenticatedApi>
  readOnly: boolean
  onOps: (ops: GraphOp[]) => LocalApplyResult
  onLayout: () => void
  onRecordDecision: (input: { summary: string; rationale: string; nodeIds: string[]; edgeIds: string[] }) => Promise<unknown>
  onUpsertTakeaway?: (input: TakeawayInput) => void
  onRemoveTakeaway?: (takeawayId: string) => void
}

/** Editable swimlane canvas bound to a Process Studio graph; every edit is emitted as graph ops. */
export default function ProcessCanvas(
  {
    graph, decisions, takeaways, pendingPreview, people, authenticatedApi, readOnly, onOps, onLayout,
    onRecordDecision, onUpsertTakeaway, onRemoveTakeaway,
  }: ProcessCanvasProps,
) {
  const { resolvedThemeMode } = useTheme()
  const toasts = useKumoToastManager()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingLane, setAddingLane] = useState(false)

  const { lockedNodeIds, lockedEdgeIds } = useMemo(() => {
    const nodeIds = new Set<string>()
    const edgeIds = new Set<string>()
    for (const decision of decisions) {
      if (decision.status !== 'active' || !decision.locked) continue
      for (const id of decision.nodeIds) nodeIds.add(id)
      for (const id of decision.edgeIds) edgeIds.add(id)
    }
    return { lockedNodeIds: nodeIds, lockedEdgeIds: edgeIds }
  }, [decisions])

  const hasPendingPreview = !!pendingPreview && (
    pendingPreview.addedNodes.length > 0 || pendingPreview.addedEdges.length > 0 ||
    pendingPreview.removedNodeIds.length > 0 || pendingPreview.removedEdgeIds.length > 0 ||
    pendingPreview.changedNodeIds.length > 0 || pendingPreview.changedEdgeIds.length > 0
  )

  const submit = useCallback(
    (ops: GraphOp[]) => {
      if (ops.length === 0) return true
      const result = onOps(ops)
      if (!result.ok) toasts.add({ title: result.reason, variant: 'error' })
      return result.ok
    },
    [onOps, toasts],
  )

  // Stable identity so node data (and React Flow's node state) isn't rebuilt on every render.
  const latest = useRef({ graph, submit })
  useEffect(() => {
    latest.current = { graph, submit }
  })
  const commitRename = useCallback((id: string, label: string) => {
    setEditingId(null)
    const next = label.trim()
    const node = latest.current.graph.nodes.find((n) => n.id === id)
    if (next && node && next !== node.label) latest.current.submit([{ op: 'updateNode', id, label: next }])
  }, [])

  const builtNodes = useMemo(
    () => buildNodes(graph, editingId, lockedNodeIds, commitRename, pendingPreview),
    [graph, editingId, lockedNodeIds, commitRename, pendingPreview],
  )
  const builtEdges = useMemo(
    () => buildEdges(graph, lockedEdgeIds, pendingPreview),
    [graph, lockedEdgeIds, pendingPreview],
  )
  const [nodes, setNodes] = useState<Node[]>(builtNodes)
  const [edges, setEdges] = useState<Edge[]>(builtEdges)
  useEffect(() => setNodes((current) => mergeNodes(current, builtNodes)), [builtNodes])
  useEffect(() => setEdges((current) => mergeEdges(current, builtEdges)), [builtEdges])

  // Removals are emitted as ops and arrive back through `graph`, so a rejected delete never vanishes.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), current)),
    [],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), current)),
    [],
  )

  const onNodeDragStop = useCallback(
    (_event: unknown, _node: Node, dragged: Node[]) => {
      const moves: GraphOp[] = []
      const laneChanges: GraphOp[] = []
      for (const flowNode of dragged) {
        const node = graph.nodes.find((n) => n.id === flowNode.id)
        if (!node) continue
        const x = Math.round(flowNode.position.x)
        const y = Math.round(flowNode.position.y)
        if (x !== node.x || y !== node.y) moves.push({ op: 'moveNode', id: node.id, x, y })
        const centre = y + stepSize(node.type).height / 2
        const lane = graph.lanes[Math.min(graph.lanes.length - 1, Math.max(0, Math.floor(centre / LANE_HEIGHT)))]
        if (lane && lane.id !== node.laneId) laneChanges.push({ op: 'updateNode', id: node.id, laneId: lane.id })
      }
      if (submit(moves)) submit(laneChanges)
    },
    [graph, submit],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return
      submit([{ op: 'addEdge', edge: { id: newId('flow'), source: connection.source, target: connection.target } }])
    },
    [submit],
  )

  const onDelete = useCallback(
    ({ nodes: removedNodes, edges: removedEdges }: { nodes: Node[]; edges: Edge[] }) => {
      const nodeIds = new Set(removedNodes.filter((n) => n.type === 'step').map((n) => n.id))
      submit([
        ...[...nodeIds].map((id): GraphOp => ({ op: 'deleteNode', id })),
        ...removedEdges
          .filter((e) => !nodeIds.has(e.source) && !nodeIds.has(e.target))
          .map((e): GraphOp => ({ op: 'deleteEdge', id: e.id })),
      ])
    },
    [submit],
  )

  const selectedStep = nodes.find((n) => n.selected && n.type === 'step')
  const selectedNode = selectedStep ? graph.nodes.find((n) => n.id === selectedStep.id) : undefined
  const selectedTakeaways = selectedNode
    ? takeaways.filter((item) => item.nodeIds.includes(selectedNode.id))
    : []
  const closeDetails = useCallback(
    () => setNodes((current) => current.map((n) => (n.selected ? { ...n, selected: false } : n))),
    [],
  )
  const patchSelected = useCallback(
    (patch: StepDetailPatch) => {
      if (!selectedNode) return
      submit([{ op: 'updateNode', id: selectedNode.id, ...patch }])
    },
    [selectedNode, submit],
  )
  const lockSelected = useCallback(
    (input: { summary: string; rationale: string }) => {
      if (!selectedNode) return
      onRecordDecision({ ...input, nodeIds: [selectedNode.id], edgeIds: [] }).catch((err: unknown) =>
        toasts.add({ title: err instanceof Error ? err.message : String(err), variant: 'error' }),
      )
    },
    [selectedNode, onRecordDecision, toasts],
  )

  const addLane = (label: string) => {
    if (submit([{ op: 'addLane', lane: { id: newId('lane'), label } }])) setAddingLane(false)
  }

  const addStep = () => {
    const laneId = selectedNode?.laneId ?? graph.lanes[0]?.id
    if (!laneId) return
    const id = newId('step')
    if (submit([{ op: 'addNode', node: { id, type: 'userTask', label: 'New step', laneId } }])) setEditingId(id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">
      {!readOnly && graph.lanes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-kumo-line px-3 py-2">
          {addingLane ? (
            <LaneInput onSubmit={addLane} onCancel={() => setAddingLane(false)} />
          ) : (
            <button type="button" onClick={() => setAddingLane(true)} className={toolbarButton}>
              <Rows size={14} />
              Add lane
            </button>
          )}
          <button type="button" onClick={addStep} className={toolbarButton}>
            <Plus size={14} />
            Add step
          </button>
          <button type="button" onClick={onLayout} className={toolbarButton} title="Recompute step positions from the flow">
            <ArrowsClockwise size={14} />
            Tidy layout
          </button>
          {hasPendingPreview && (
            <span
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-kumo-brand/15 px-2.5 text-[12.5px] font-medium text-kumo-brand"
              title="Dashed ghosts are proposed additions, dashed rings are proposed edits, faded elements are proposed removals"
            >
              <Sparkle size={14} weight="fill" />
              Pending proposal preview
            </span>
          )}
          {selectedNode && (
            <select
              aria-label="Step type"
              value={selectedNode.type}
              onChange={(event) =>
                submit([{ op: 'updateNode', id: selectedNode.id, type: event.target.value as ProcessNodeType }])
              }
              className="h-8 rounded-lg border border-kumo-line bg-kumo-base px-2 text-[12.5px] text-kumo-default"
            >
              {PROCESS_NODE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {NODE_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          )}
          <span className="ml-auto text-[11.5px] text-kumo-inactive">
            Double-click a step to rename · drag between handles to connect · Delete to remove
          </span>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            colorMode={resolvedThemeMode}
            fitView
            fitViewOptions={{ padding: 0.08 }}
            minZoom={0.3}
            zoomOnDoubleClick={false}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            deleteKeyCode={readOnly ? null : ['Delete', 'Backspace']}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={readOnly ? undefined : onNodeDragStop}
            onConnect={readOnly ? undefined : onConnect}
            onDelete={readOnly ? undefined : onDelete}
            onNodeDoubleClick={readOnly ? undefined : (_event, node) => node.type === 'step' && setEditingId(node.id)}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
          {graph.lanes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-sm rounded-xl border border-kumo-line bg-kumo-elevated p-5 text-center shadow-sm">
                <p className="text-[14px] font-semibold text-kumo-default">
                  {readOnly ? 'This process is empty' : 'Start mapping this process'}
                </p>
                <p className="mt-1 text-[12.5px] text-kumo-subtle">
                  {readOnly
                    ? 'Nothing has been mapped yet.'
                    : 'Add the first lane: a role, team, or system that performs steps.'}
                </p>
                {!readOnly && (
                  <div className="mt-3 flex justify-center">
                    <LaneInput onSubmit={addLane} />
                  </div>
                )}
              </div>
            </div>
          )}
          {!readOnly && graph.lanes.length > 0 && graph.nodes.length === 0 && (
            <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-lg bg-kumo-elevated px-3 py-1.5 text-[12px] text-kumo-subtle shadow-sm">
              Add the first step with “Add step”.
            </p>
          )}
        </div>
        {selectedNode && (
          <StepDetailsPanel
            key={selectedNode.id}
            node={selectedNode}
            takeaways={selectedTakeaways}
            readOnly={readOnly}
            locked={lockedNodeIds.has(selectedNode.id)}
            people={people}
            authenticatedApi={authenticatedApi}
            onPatch={patchSelected}
            onLock={lockSelected}
            onUpsertTakeaway={onUpsertTakeaway}
            onRemoveTakeaway={onRemoveTakeaway}
            onClose={closeDetails}
          />
        )}
      </div>
    </div>
  )
}
