import {
  addEdge,
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
import { memo, useCallback, useMemo, useState } from 'react'
import { Clock, Gear, Hand, Table, User, Warning } from '@phosphor-icons/react'
import { useTheme } from '../ThemeContext'
import type { PainPoint, ProcessModel, ProcessModelNode } from './prototype'
import { formatGbp } from './ui'
import '@xyflow/react/dist/style.css'

const LANE_LABEL_WIDTH = 132
const LANE_HEIGHT = 132
const COLUMN_WIDTH = 190
const TASK_WIDTH = 152
const TASK_HEIGHT = 60
const EVENT_SIZE = 38
const GATEWAY_SIZE = 42

type LaneData = { label: string; width: number }
type ElementData = {
  element: ProcessModelNode
  painPoints: PainPoint[]
  highlighted: boolean
  dimmed: boolean
  active: boolean
}

const LaneNode = memo(function LaneNode({ data }: NodeProps<Node<LaneData>>) {
  return (
    <div
      className="flex border-b border-kumo-line/70"
      style={{ width: data.width, height: LANE_HEIGHT }}
    >
      <div
        className="flex shrink-0 items-center border-r border-kumo-line/70 bg-kumo-tint/60 px-3 text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle"
        style={{ width: LANE_LABEL_WIDTH }}
      >
        {data.label}
      </div>
    </div>
  )
})

function ringClass(data: ElementData): string {
  if (data.active) return 'ring-2 ring-kumo-success ring-offset-2 ring-offset-kumo-base'
  if (data.highlighted) return 'ring-2 ring-kumo-brand ring-offset-2 ring-offset-kumo-base'
  return ''
}

const taskIcon: Partial<Record<ProcessModelNode['type'], typeof User>> = {
  userTask: User,
  serviceTask: Gear,
  manualTask: Hand,
}

const ElementNode = memo(function ElementNode({ data }: NodeProps<Node<ElementData>>) {
  const { element } = data
  const opacity = data.dimmed ? 'opacity-35' : ''
  const handles = (
    <>
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-none !bg-kumo-subtle" />
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-none !bg-kumo-subtle" />
    </>
  )
  const caption = (
    <span className="absolute left-1/2 top-full mt-1 w-[140px] -translate-x-1/2 text-center text-[10.5px] leading-[13px] text-kumo-default">
      {element.label}
    </span>
  )

  if (element.type === 'startEvent' || element.type === 'endEvent' || element.type === 'timerEvent') {
    const border =
      element.type === 'startEvent'
        ? 'border-2 border-emerald-500'
        : element.type === 'endEvent'
          ? element.isException
            ? 'border-[4px] border-rose-500'
            : 'border-[4px] border-kumo-default'
          : 'border-2 border-double border-amber-500 outline outline-1 outline-offset-2 outline-amber-500/60'
    return (
      <div className={`relative ${opacity}`} style={{ width: EVENT_SIZE, height: EVENT_SIZE }}>
        <div className={`flex h-full w-full items-center justify-center rounded-full bg-kumo-base ${border} ${ringClass(data)}`}>
          {element.type === 'timerEvent' && <Clock size={16} className="text-amber-500" />}
        </div>
        {caption}
        {handles}
      </div>
    )
  }

  if (element.type === 'exclusiveGateway' || element.type === 'parallelGateway') {
    return (
      <div className={`relative ${opacity}`} style={{ width: GATEWAY_SIZE, height: GATEWAY_SIZE }}>
        <div
          className={`absolute inset-[6px] rotate-45 rounded-[3px] border-2 border-amber-500 bg-kumo-base ${ringClass(data)}`}
        />
        <span className="absolute inset-0 flex items-center justify-center text-[15px] font-bold text-amber-500">
          {element.decisionTableId ? <Table size={14} weight="bold" /> : element.type === 'parallelGateway' ? '+' : '×'}
        </span>
        {caption}
        {handles}
      </div>
    )
  }

  const Icon = taskIcon[element.type] ?? User
  const pain = data.painPoints[0]
  return (
    <div
      className={`relative flex flex-col justify-between rounded-lg border bg-kumo-base px-2 py-1.5 shadow-sm ${
        element.isException ? 'border-dashed border-amber-500' : pain ? 'border-rose-500/70' : 'border-kumo-line'
      } ${ringClass(data)} ${opacity}`}
      style={{ width: TASK_WIDTH, height: TASK_HEIGHT }}
    >
      <div className="flex items-center justify-between gap-1 text-[10px] text-kumo-subtle">
        <span className="inline-flex items-center gap-1">
          <Icon size={11} />
          {element.approval ? 'Approval' : element.type === 'serviceTask' ? 'Service' : element.type === 'manualTask' ? 'Manual' : 'User'}
        </span>
        {element.slaHours !== undefined && (
          <span>SLA {element.slaHours < 1 ? `${Math.round(element.slaHours * 60)}m` : `${element.slaHours}h`}</span>
        )}
      </div>
      <p className="line-clamp-2 text-[11px] font-medium leading-[13px] text-kumo-default">{element.label}</p>
      {pain && (
        <span className="absolute -right-2 -top-2.5 inline-flex items-center gap-0.5 rounded-md bg-rose-500 px-1 py-0.5 text-[9.5px] font-semibold text-white shadow">
          <Warning size={10} weight="fill" />
          {formatGbp(pain.annualCost).replace(/,000$/, 'k')}
        </span>
      )}
      {handles}
    </div>
  )
})

const nodeTypes = { lane: LaneNode, element: ElementNode }

function elementSize(node: ProcessModelNode): { width: number; height: number } {
  if (node.type === 'exclusiveGateway' || node.type === 'parallelGateway') return { width: GATEWAY_SIZE, height: GATEWAY_SIZE }
  if (node.type === 'startEvent' || node.type === 'endEvent' || node.type === 'timerEvent') return { width: EVENT_SIZE, height: EVENT_SIZE }
  return { width: TASK_WIDTH, height: TASK_HEIGHT }
}

type DiagramOptions = {
  painPoints: PainPoint[]
  highlightNodeIds?: ReadonlySet<string>
  activeNodeId?: string
}

function buildNodes(model: ProcessModel, options: DiagramOptions): Node[] {
  const maxColumn = Math.max(0, ...model.nodes.map((n) => n.column))
  const width = LANE_LABEL_WIDTH + (maxColumn + 1) * COLUMN_WIDTH + 24
  const laneIndex = new Map(model.lanes.map((lane, index) => [lane.id, index]))
  const hasHighlight = (options.highlightNodeIds?.size ?? 0) > 0
  const lanes: Node[] = model.lanes.map((lane, index) => ({
    id: `lane:${lane.id}`,
    type: 'lane',
    position: { x: 0, y: index * LANE_HEIGHT },
    data: { label: lane.label, width },
    draggable: false,
    selectable: false,
    connectable: false,
    zIndex: -1,
  }))
  const elements: Node[] = model.nodes.map((node) => {
    const size = elementSize(node)
    const lane = laneIndex.get(node.laneId) ?? 0
    const highlighted = options.highlightNodeIds?.has(node.id) ?? false
    return {
      id: node.id,
      type: 'element',
      position: {
        x: LANE_LABEL_WIDTH + node.column * COLUMN_WIDTH + (COLUMN_WIDTH - size.width) / 2,
        y: lane * LANE_HEIGHT + (LANE_HEIGHT - size.height) / 2 - (size.height < TASK_HEIGHT ? 8 : 0),
      },
      data: {
        element: node,
        painPoints: options.painPoints.filter((p) => p.nodeId === node.id),
        highlighted,
        dimmed: hasHighlight && !highlighted,
        active: options.activeNodeId === node.id,
      } satisfies ElementData,
    }
  })
  return [...lanes, ...elements]
}

function buildEdges(model: ProcessModel): Edge[] {
  return model.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    label: edge.condition,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: edge.isException ? { strokeDasharray: '5 4', stroke: '#f59e0b', strokeWidth: 1.5 } : { strokeWidth: 1.5 },
    labelStyle: { fontSize: 10.5 },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 4,
  }))
}

export type ProcessDiagramProps = DiagramOptions & {
  model: ProcessModel
  height?: number | string
  /** Allows moving elements and drawing new sequence flows (local only in the prototype). */
  editable?: boolean
  onNodeClick?: (nodeId: string) => void
}

/** Swimlane process diagram using BPMN 2.0 element types, drawn in a simplified style. */
export default function ProcessDiagram({
  model,
  painPoints,
  highlightNodeIds,
  activeNodeId,
  height = 460,
  editable = false,
  onNodeClick,
}: ProcessDiagramProps) {
  const { resolvedThemeMode } = useTheme()
  const derivedNodes = useMemo(
    () => buildNodes(model, { painPoints, highlightNodeIds, activeNodeId }),
    [model, painPoints, highlightNodeIds, activeNodeId],
  )
  const derivedEdges = useMemo(() => buildEdges(model), [model])
  // Editable diagrams own their node/edge state so moves and new flows stick; read-only diagrams
  // always render straight from the model so highlight/active changes flow through.
  const [editedNodes, setEditedNodes] = useState<Node[] | null>(null)
  const [editedEdges, setEditedEdges] = useState<Edge[] | null>(null)
  const nodes = useMemo(() => {
    if (!editable || !editedNodes) return derivedNodes
    const derivedData = new Map(derivedNodes.map((node) => [node.id, node.data]))
    return editedNodes.map((node) => ({ ...node, data: derivedData.get(node.id) ?? node.data }))
  }, [derivedNodes, editable, editedNodes])
  const edges = editable && editedEdges ? editedEdges : derivedEdges

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setEditedNodes((current) => applyNodeChanges(changes, current ?? derivedNodes)),
    [derivedNodes],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEditedEdges((current) => applyEdgeChanges(changes, current ?? derivedEdges)),
    [derivedEdges],
  )
  const onConnect = useCallback(
    (connection: Connection) =>
      setEditedEdges((current) =>
        addEdge(
          { ...connection, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } },
          current ?? derivedEdges,
        ),
      ),
    [derivedEdges],
  )

  return (
    <div className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base" style={{ height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={resolvedThemeMode}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.3}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable={editable || Boolean(onNodeClick)}
        onNodesChange={editable ? onNodesChange : undefined}
        onEdgesChange={editable ? onEdgesChange : undefined}
        onConnect={editable ? onConnect : undefined}
        onNodeClick={onNodeClick ? (_event, node) => node.type === 'element' && onNodeClick(node.id) : undefined}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
