import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowsClockwise, Clock, Gear, Hand, Sparkle, User, Warning } from '@phosphor-icons/react'
import { useKumoToastManager } from '@cloudflare/kumo'
import { LANE_HEIGHT } from '@gadgets/gatekeeper-process/graph-ops'
import type { GraphOp, ProcessGraph, ProcessLane, ProcessNode, ProcessNodeType } from '@gadgets/gatekeeper-process/types'
import type { PendingPreview } from '@gadgets/gatekeeper-process/ui-types'
import { useTheme } from '../ThemeContext'
import type { LocalApplyResult } from './opQueue'
import '@xyflow/react/dist/style.css'

const LANE_LABEL_WIDTH = 132
const MIN_LANE_WIDTH = 900
const TASK_WIDTH = 160
const TASK_HEIGHT = 64
const EVENT_SIZE = 38
const GATEWAY_SIZE = 42

const taskIcon: Partial<Record<ProcessNodeType, typeof User>> = { userTask: User, serviceTask: Gear, manualTask: Hand }

/** How the agent's pending proposals would change an element. */
type Proposed = 'added' | 'changed' | 'removed'

type LaneData = { label: string; width: number; proposed: boolean }
type StepData = {
  node: ProcessNode
  editing: boolean
  proposed?: Proposed
  onRename: (id: string, label: string) => void
}

const LaneBand = memo(function LaneBand({ data }: NodeProps<Node<LaneData>>) {
  return (
    <div
      className={`flex border-b ${data.proposed ? 'border-dashed border-kumo-brand' : 'border-kumo-line'}`}
      style={{ width: data.width, height: LANE_HEIGHT }}
    >
      <div
        className={`flex shrink-0 items-center gap-1.5 border-r px-3 text-[11px] font-semibold uppercase tracking-wide ${
          data.proposed ? 'border-dashed border-kumo-brand bg-kumo-info-tint text-kumo-brand' : 'border-kumo-line bg-kumo-tint text-kumo-subtle'
        }`}
        style={{ width: LANE_LABEL_WIDTH }}
      >
        {data.proposed && <Sparkle size={11} weight="fill" aria-hidden />}
        <span className="min-w-0 truncate">{data.label}</span>
      </div>
    </div>
  )
})

const StepLabel = ({ data, className }: { data: StepData; className: string }) => {
  if (!data.editing) return <span className={className}>{data.node.label}</span>
  return (
    <input
      autoFocus
      defaultValue={data.node.label}
      aria-label="Step name"
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => data.onRename(data.node.id, event.currentTarget.value)}
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
  const { node, proposed } = data
  const ring = selected ? 'ring-2 ring-kumo-brand ring-offset-2 ring-offset-kumo-base' : ''
  const fade = proposed === 'added' ? 'opacity-70' : proposed === 'removed' ? 'opacity-40' : ''
  const overlay = (
    <>
      {proposed && (
        <div
          aria-hidden
          className={`pointer-events-none absolute -inset-1.5 rounded-lg border-2 border-dashed motion-safe:animate-pulse ${
            proposed === 'removed' ? 'border-kumo-danger' : 'border-kumo-brand'
          }`}
        />
      )}
      {proposed && proposed !== 'removed' && (
        <span aria-hidden className="absolute -left-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full border border-kumo-brand bg-kumo-base text-kumo-brand">
          <Sparkle size={9} weight="fill" />
        </span>
      )}
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-none !bg-kumo-subtle" />
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-none !bg-kumo-subtle" />
    </>
  )
  const caption = (
    <StepLabel
      data={data}
      className="absolute left-1/2 top-full mt-1 w-[150px] -translate-x-1/2 text-center text-[10.5px] leading-[13px] text-kumo-default"
    />
  )

  if (node.type === 'startEvent' || node.type === 'endEvent' || node.type === 'timerEvent') {
    const border = node.type === 'startEvent'
      ? 'border-2 border-kumo-success'
      : node.type === 'endEvent' ? 'border-4 border-kumo-contrast' : 'border-2 border-double border-kumo-warning'
    return (
      <div className={`relative ${fade}`} style={{ width: EVENT_SIZE, height: EVENT_SIZE }} title={node.description}>
        <div className={`flex h-full w-full items-center justify-center rounded-full bg-kumo-base ${border} ${ring}`}>
          {node.type === 'timerEvent' && <Clock size={16} className="text-kumo-warning" aria-hidden />}
        </div>
        {caption}
        {overlay}
      </div>
    )
  }

  if (node.type === 'exclusiveGateway' || node.type === 'parallelGateway') {
    return (
      <div className={`relative ${fade}`} style={{ width: GATEWAY_SIZE, height: GATEWAY_SIZE }} title={node.description}>
        <div className={`absolute inset-[6px] rotate-45 rounded-[3px] border-2 border-kumo-warning bg-kumo-base ${ring}`} />
        <span aria-hidden className="absolute inset-0 flex items-center justify-center text-[15px] font-bold text-kumo-warning">
          {node.type === 'parallelGateway' ? '+' : '×'}
        </span>
        {caption}
        {overlay}
      </div>
    )
  }

  const Icon = taskIcon[node.type] ?? User
  return (
    <div
      className={`relative flex flex-col justify-between rounded-lg border border-kumo-line bg-kumo-base px-2 py-1.5 shadow-sm ${ring} ${fade}`}
      style={{ width: TASK_WIDTH, height: TASK_HEIGHT }}
      title={node.description}
    >
      <StepLabel data={data} className="line-clamp-2 w-full text-[11.5px] font-medium leading-[14px] text-kumo-default" />
      <span className="flex min-w-0 items-center gap-2 text-[10px] text-kumo-subtle">
        <span className="inline-flex min-w-0 items-center gap-1">
          <Icon size={11} aria-hidden />
          <span className="truncate">{node.owner ?? node.system ?? 'Owner not known yet'}</span>
        </span>
        {node.duration && (
          <span className="inline-flex shrink-0 items-center gap-0.5">
            <Clock size={10} aria-hidden />
            {node.duration.amount} {node.duration.unit}
          </span>
        )}
        {node.painPoints && (
          <span className="ml-auto inline-flex shrink-0 text-kumo-warning" title={node.painPoints}>
            <Warning size={11} weight="fill" aria-label="Known pain point" />
          </span>
        )}
      </span>
      {overlay}
    </div>
  )
})

const nodeTypes = { lane: LaneBand, step: StepNode }

function stepHeight(type: ProcessNodeType): number {
  if (type === 'exclusiveGateway' || type === 'parallelGateway') return GATEWAY_SIZE
  if (type === 'startEvent' || type === 'endEvent' || type === 'timerEvent') return EVENT_SIZE
  return TASK_HEIGHT
}

function describeStep(node: ProcessNode, proposed?: Proposed): string {
  const prefix = proposed === 'added' ? 'Proposed step' : proposed === 'removed' ? 'Step proposed for removal' : 'Step'
  return `${prefix}: ${node.label}${node.owner ? `, done by ${node.owner}` : ''}`
}

function buildNodes(
  graph: ProcessGraph,
  lanes: ProcessLane[],
  preview: PendingPreview | null,
  editingId: string | null,
  onRename: StepData['onRename'],
): Node[] {
  const proposedLaneIds = new Set(preview?.addedLanes.map((lane) => lane.id) ?? [])
  const ghosts = preview?.addedNodes ?? []
  const width = LANE_LABEL_WIDTH + Math.max(MIN_LANE_WIDTH, ...[...graph.nodes, ...ghosts].map((n) => n.x + TASK_WIDTH + 240))
  const laneNodes: Node[] = lanes.map((lane, index) => ({
    id: `lane:${lane.id}`,
    type: 'lane',
    position: { x: -LANE_LABEL_WIDTH, y: index * LANE_HEIGHT },
    data: { label: lane.label, width, proposed: proposedLaneIds.has(lane.id) } satisfies LaneData,
    draggable: false,
    selectable: false,
    connectable: false,
    deletable: false,
    focusable: false,
    zIndex: -1,
  }))
  const removed = new Set(preview?.removedNodeIds ?? [])
  const changed = new Set(preview?.changedNodeIds ?? [])
  const steps: Node[] = graph.nodes.map((node) => {
    const proposed: Proposed | undefined = removed.has(node.id) ? 'removed' : changed.has(node.id) ? 'changed' : undefined
    return {
      id: node.id,
      type: 'step',
      position: { x: node.x, y: node.y },
      ariaLabel: describeStep(node, proposed),
      data: { node, editing: editingId === node.id, proposed, onRename } satisfies StepData,
    }
  })
  const ghostNodes: Node[] = ghosts.map((node) => ({
    id: node.id,
    type: 'step',
    position: { x: node.x, y: node.y },
    ariaLabel: describeStep(node, 'added'),
    data: { node, editing: false, proposed: 'added', onRename } satisfies StepData,
    draggable: false,
    selectable: false,
    connectable: false,
    deletable: false,
  }))
  return [...laneNodes, ...steps, ...ghostNodes]
}

const edgeLook = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  labelStyle: { fontSize: 10.5 },
  labelBgPadding: [4, 2] as [number, number],
  labelBgBorderRadius: 4,
}

function buildEdges(graph: ProcessGraph, preview: PendingPreview | null): Edge[] {
  const removed = new Set(preview?.removedEdgeIds ?? [])
  const changed = new Set(preview?.changedEdgeIds ?? [])
  const committed: Edge[] = graph.edges.map((edge) => ({
    ...edgeLook,
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    style: removed.has(edge.id)
      ? { strokeWidth: 1.5, stroke: 'var(--color-kumo-danger)', strokeDasharray: '4 3', opacity: 0.5 }
      : changed.has(edge.id)
        ? { strokeWidth: 1.5, stroke: 'var(--color-kumo-brand)', strokeDasharray: '4 3' }
        : { strokeWidth: 1.5 },
  }))
  const ghosts: Edge[] = (preview?.addedEdges ?? []).map((edge) => ({
    ...edgeLook,
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    animated: true,
    selectable: false,
    style: { strokeWidth: 1.5, stroke: 'var(--color-kumo-brand)', opacity: 0.8 },
  }))
  return [...committed, ...ghosts]
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

/** Frames the map whenever it grows, so a draft drawing itself is always in view. */
function FrameOnGrowth({ count }: { count: number }) {
  const { fitView } = useReactFlow()
  const previous = useRef(count)
  useEffect(() => {
    if (count > previous.current) void fitView({ padding: 0.12, duration: 450 })
    previous.current = count
  }, [count, fitView])
  return null
}

export type ProcessMapProps = {
  graph: ProcessGraph
  /** How the agent's pending proposals would change the map, shown until they are decided. */
  preview: PendingPreview | null
  readOnly: boolean
  onOps: (ops: GraphOp[]) => LocalApplyResult
  onTidy: () => void
  /** A step was picked, to point the conversation at it. */
  onPickStep: (step: ProcessNode) => void
}

/** The live process map: drawn from the project, edited by hand or by accepting the agent's proposals. */
export default function ProcessMap(props: ProcessMapProps) {
  return (
    <ReactFlowProvider>
      <ProcessMapFlow {...props} />
    </ReactFlowProvider>
  )
}

const ProcessMapFlow = ({ graph, preview, readOnly, onOps, onTidy, onPickStep }: ProcessMapProps) => {
  const { resolvedThemeMode } = useTheme()
  const toasts = useKumoToastManager()
  const [editingId, setEditingId] = useState<string | null>(null)

  const lanes = useMemo(() => [...graph.lanes, ...(preview?.addedLanes ?? [])], [graph.lanes, preview])

  const submit = useCallback((ops: GraphOp[]) => {
    if (ops.length === 0) return true
    const result = onOps(ops)
    if (!result.ok) toasts.add({ title: result.reason, variant: 'error' })
    return result.ok
  }, [onOps, toasts])

  // Read through a ref so renaming doesn't rebuild every node (and React Flow's state) per render.
  const latest = useRef({ graph, submit })
  useEffect(() => {
    latest.current = { graph, submit }
  })
  const rename = useCallback((id: string, label: string) => {
    setEditingId(null)
    const next = label.trim()
    const node = latest.current.graph.nodes.find((n) => n.id === id)
    if (next && node && next !== node.label) latest.current.submit([{ op: 'updateNode', id, label: next }])
  }, [])

  const builtNodes = useMemo(
    () => buildNodes(graph, lanes, preview, editingId, rename),
    [graph, lanes, preview, editingId, rename],
  )
  const builtEdges = useMemo(() => buildEdges(graph, preview), [graph, preview])
  const [nodes, setNodes] = useState<Node[]>(builtNodes)
  const [edges, setEdges] = useState<Edge[]>(builtEdges)
  useEffect(() => setNodes((current) => mergeNodes(current, builtNodes)), [builtNodes])
  useEffect(() => setEdges((current) => mergeEdges(current, builtEdges)), [builtEdges])

  // Removals go out as ops and come back through `graph`, so a refused delete never vanishes.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), current)),
    [],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), current)),
    [],
  )

  const onNodeDragStop = useCallback((_event: unknown, _node: Node, dragged: Node[]) => {
    const moves: GraphOp[] = []
    const laneChanges: GraphOp[] = []
    for (const flowNode of dragged) {
      const node = graph.nodes.find((n) => n.id === flowNode.id)
      if (!node) continue
      const x = Math.round(flowNode.position.x)
      const y = Math.round(flowNode.position.y)
      if (x !== node.x || y !== node.y) moves.push({ op: 'moveNode', id: node.id, x, y })
      const centre = y + stepHeight(node.type) / 2
      const lane = graph.lanes[Math.min(graph.lanes.length - 1, Math.max(0, Math.floor(centre / LANE_HEIGHT)))]
      if (lane && lane.id !== node.laneId) laneChanges.push({ op: 'updateNode', id: node.id, laneId: lane.id })
    }
    if (submit(moves)) submit(laneChanges)
  }, [graph, submit])

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    submit([{ op: 'addEdge', edge: { id: `flow-${crypto.randomUUID().slice(0, 8)}`, source: connection.source, target: connection.target } }])
  }, [submit])

  const onDelete = useCallback(({ nodes: removedNodes, edges: removedEdges }: { nodes: Node[]; edges: Edge[] }) => {
    const nodeIds = new Set(removedNodes.filter((n) => n.type === 'step').map((n) => n.id))
    submit([
      ...[...nodeIds].map((id): GraphOp => ({ op: 'deleteNode', id })),
      ...removedEdges
        .filter((e) => !nodeIds.has(e.source) && !nodeIds.has(e.target))
        .map((e): GraphOp => ({ op: 'deleteEdge', id: e.id })),
    ])
  }, [submit])

  // Selection, not click: Enter on a focused step selects it too, so keyboard users can pick one.
  const picked = useRef<string | null>(null)
  const onSelectionChange = useCallback(({ nodes: selected }: { nodes: Node[] }) => {
    const step = selected.length === 1 && selected[0].type === 'step'
      ? graph.nodes.find((n) => n.id === selected[0].id)
      : undefined
    if (step && picked.current !== step.id) onPickStep(step)
    picked.current = step?.id ?? null
  }, [graph, onPickStep])

  const hasProposal = !!preview && (
    preview.addedLanes.length + preview.addedNodes.length + preview.addedEdges.length +
    preview.removedNodeIds.length + preview.removedEdgeIds.length +
    preview.changedNodeIds.length + preview.changedEdgeIds.length > 0
  )
  const empty = lanes.length === 0

  return (
    <div className="relative h-full min-h-0 w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={resolvedThemeMode}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.3}
        zoomOnDoubleClick={false}
        selectNodesOnDrag={false}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        deleteKeyCode={readOnly ? null : ['Delete', 'Backspace']}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={readOnly ? undefined : onNodeDragStop}
        onConnect={readOnly ? undefined : onConnect}
        onDelete={readOnly ? undefined : onDelete}
        onNodeDoubleClick={readOnly ? undefined : (_event, node) => node.type === 'step' && node.draggable !== false && setEditingId(node.id)}
        onSelectionChange={onSelectionChange}
        proOptions={{ hideAttribution: true }}
        aria-label="Process map"
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false}>
          {!readOnly && graph.nodes.length > 1 && (
            <ControlButton onClick={onTidy} title="Tidy the map" aria-label="Tidy the map">
              <ArrowsClockwise />
            </ControlButton>
          )}
        </Controls>
        <FrameOnGrowth count={nodes.length} />
      </ReactFlow>
      {hasProposal && (
        <p
          role="status"
          className="pointer-events-none absolute left-1/2 top-3 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-kumo-brand bg-kumo-base px-3 py-1 text-[12px] font-medium text-kumo-brand shadow-sm"
        >
          <Sparkle size={12} weight="fill" aria-hidden />
          Proposed by your analyst. Accept or reject it in the conversation.
        </p>
      )}
      {empty && !hasProposal && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
          <Sparkle size={22} className="text-kumo-brand" aria-hidden />
          <p className="max-w-xs text-[14px] font-medium text-kumo-default">Your process map draws itself here as you talk.</p>
        </div>
      )}
    </div>
  )
}
