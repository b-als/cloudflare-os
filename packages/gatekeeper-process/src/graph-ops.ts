import type {
  GraphOp,
  ProcessEdge,
  ProcessGraph,
  ProcessLane,
  ProcessNode,
  ProcessNodeType,
  StepDuration,
} from "./types.js";

/** Node kinds accepted by the reducer. */
export const PROCESS_NODE_TYPES: readonly ProcessNodeType[] = [
  "startEvent",
  "endEvent",
  "timerEvent",
  "userTask",
  "serviceTask",
  "manualTask",
  "exclusiveGateway",
  "parallelGateway",
];

export const MAX_ID_LENGTH = 64;
export const MAX_LABEL_LENGTH = 200;
export const MAX_OPS_PER_BATCH = 500;
export const MAX_LANES = 50;
export const MAX_NODES = 1000;
export const MAX_EDGES = 2000;
export const MAX_COORDINATE = 1_000_000;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_OWNER_LENGTH = 200;
export const MAX_SYSTEM_LENGTH = 200;
export const MAX_PAIN_POINTS_LENGTH = 2000;
export const MAX_LIST_ITEMS = 20;
export const MAX_LIST_ITEM_LENGTH = 200;
export const MAX_DURATION_AMOUNT = 1_000_000;

/** Auto-placement layout constants, in canvas pixels. */
export const LANE_HEIGHT = 160;
export const LANE_PADDING_Y = 60;
export const FIRST_NODE_X = 80;
export const NODE_SPACING_X = 200;
/** Vertical gap between steps that land in the same lane and flow column. */
export const STACK_OFFSET_Y = 70;

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const NODE_TYPES = new Set<string>(PROCESS_NODE_TYPES);

/** A rejected graph edit. `opIndex` is -1 when the batch as a whole is invalid. */
export class GraphOpError extends Error {
  readonly opIndex: number;

  constructor(opIndex: number, message: string) {
    super(opIndex >= 0 ? `Op ${opIndex}: ${message}` : message);
    this.name = "GraphOpError";
    this.opIndex = opIndex;
  }
}

/** Lock state the reducer enforces. */
export type GraphOpOptions = {
  lockedNodeIds?: Iterable<string>;
  lockedEdgeIds?: Iterable<string>;
  /** Permit modifying or deleting locked elements. `moveNode` is always permitted. */
  allowLocked?: boolean;
};

/** Element IDs a batch adds, changes, moves, or deletes. */
export type TouchedIds = {
  laneIds: string[];
  nodeIds: string[];
  edgeIds: string[];
};

type WorkingGraph = {
  lanes: Map<string, ProcessLane>;
  nodes: Map<string, ProcessNode>;
  edges: Map<string, ProcessEdge>;
  lockedNodes: ReadonlySet<string>;
  lockedEdges: ReadonlySet<string>;
  allowLocked: boolean;
};

/**
 * Applies `ops` in order and returns the resulting graph, leaving `graph` untouched. The revision
 * is carried over unchanged; the caller owns revision numbering. Throws `GraphOpError`.
 */
export function applyGraphOps(
  graph: ProcessGraph,
  ops: readonly GraphOp[],
  options: GraphOpOptions = {},
): ProcessGraph {
  if (!Array.isArray(ops)) throw new GraphOpError(-1, "Ops must be an array.");
  if (ops.length > MAX_OPS_PER_BATCH) {
    throw new GraphOpError(-1, `A batch may contain at most ${MAX_OPS_PER_BATCH} ops.`);
  }
  const working: WorkingGraph = {
    lanes: new Map(graph.lanes.map((lane) => [lane.id, { ...lane }])),
    nodes: new Map(graph.nodes.map((node) => [node.id, { ...node }])),
    edges: new Map(graph.edges.map((edge) => [edge.id, { ...edge }])),
    lockedNodes: new Set(options.lockedNodeIds ?? []),
    lockedEdges: new Set(options.lockedEdgeIds ?? []),
    allowLocked: options.allowLocked === true,
  };
  ops.forEach((op, index) => applyOne(working, op, index));
  if (working.lanes.size > MAX_LANES) {
    throw new GraphOpError(-1, `A project may have at most ${MAX_LANES} lanes.`);
  }
  if (working.nodes.size > MAX_NODES) {
    throw new GraphOpError(-1, `A project may have at most ${MAX_NODES} nodes.`);
  }
  if (working.edges.size > MAX_EDGES) {
    throw new GraphOpError(-1, `A project may have at most ${MAX_EDGES} edges.`);
  }
  return {
    revision: graph.revision,
    lanes: [...working.lanes.values()],
    nodes: [...working.nodes.values()],
    edges: [...working.edges.values()],
  };
}

/**
 * Returns the IDs `ops` touch. When `graph` is given, edges removed by a `deleteNode` cascade are
 * included. Tolerates malformed ops by skipping missing IDs.
 */
export function touchedElementIds(
  ops: readonly GraphOp[],
  graph?: Pick<ProcessGraph, "edges">,
): TouchedIds {
  const laneIds = new Set<string>();
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const add = (set: Set<string>, id: unknown) => {
    if (typeof id === "string") set.add(id);
  };
  for (const op of ops) {
    switch (op?.op) {
      case "addLane":
        add(laneIds, op.lane?.id);
        break;
      case "renameLane":
      case "deleteLane":
        add(laneIds, op.id);
        break;
      case "addNode":
        add(nodeIds, op.node?.id);
        break;
      case "updateNode":
      case "moveNode":
        add(nodeIds, op.id);
        break;
      case "deleteNode":
        add(nodeIds, op.id);
        for (const edge of graph?.edges ?? []) {
          if (edge.source === op.id || edge.target === op.id) edgeIds.add(edge.id);
        }
        break;
      case "addEdge":
        add(edgeIds, op.edge?.id);
        break;
      case "updateEdge":
      case "deleteEdge":
        add(edgeIds, op.id);
        break;
    }
  }
  return { laneIds: [...laneIds], nodeIds: [...nodeIds], edgeIds: [...edgeIds] };
}

function applyOne(graph: WorkingGraph, op: GraphOp, index: number): void {
  if (typeof op !== "object" || op === null) throw new GraphOpError(index, "Op must be an object.");
  switch (op.op) {
    case "addLane": {
      const lane = requireObject(index, op.lane, "lane");
      const id = requireId(index, lane.id, "Lane ID");
      if (graph.lanes.has(id)) throw new GraphOpError(index, `Lane "${id}" already exists.`);
      graph.lanes.set(id, { id, label: requireLaneLabel(index, lane.label) });
      return;
    }
    case "renameLane": {
      const lane = requireLane(graph, index, op.id);
      graph.lanes.set(lane.id, { ...lane, label: requireLaneLabel(index, op.label) });
      return;
    }
    case "deleteLane": {
      const lane = requireLane(graph, index, op.id);
      for (const node of graph.nodes.values()) {
        if (node.laneId === lane.id) {
          throw new GraphOpError(index, `Lane "${lane.id}" is not empty; it contains "${node.id}".`);
        }
      }
      graph.lanes.delete(lane.id);
      return;
    }
    case "addNode": {
      const input = requireObject(index, op.node, "node");
      const id = requireId(index, input.id, "Node ID");
      if (graph.nodes.has(id)) throw new GraphOpError(index, `Node "${id}" already exists.`);
      const type = requireNodeType(index, input.type);
      const label = requireLabel(index, input.label, "Node label");
      const lane = requireLane(graph, index, input.laneId);
      const placed = autoPlace(graph, lane.id);
      const x = input.x === undefined ? placed.x : requireCoordinate(index, input.x, "x");
      const y = input.y === undefined ? placed.y : requireCoordinate(index, input.y, "y");
      const node: ProcessNode = { id, type, label, laneId: lane.id, x, y };
      if (input.description !== undefined) {
        node.description = requireBoundedText(index, input.description, MAX_DESCRIPTION_LENGTH, "Description");
      }
      if (input.owner !== undefined) node.owner = requireBoundedText(index, input.owner, MAX_OWNER_LENGTH, "Owner");
      if (input.system !== undefined) {
        node.system = requireBoundedText(index, input.system, MAX_SYSTEM_LENGTH, "System");
      }
      if (input.inputs !== undefined) node.inputs = requireBoundedList(index, input.inputs, "Inputs");
      if (input.outputs !== undefined) node.outputs = requireBoundedList(index, input.outputs, "Outputs");
      if (input.duration !== undefined) node.duration = requireDuration(index, input.duration);
      if (input.painPoints !== undefined) {
        node.painPoints = requireBoundedText(index, input.painPoints, MAX_PAIN_POINTS_LENGTH, "Pain points");
      }
      graph.nodes.set(id, node);
      return;
    }
    case "updateNode": {
      const node = requireNode(graph, index, op.id);
      requireUnlockedNode(graph, index, node.id);
      const next = { ...node };
      if (op.label !== undefined) next.label = requireLabel(index, op.label, "Node label");
      if (op.type !== undefined) next.type = requireNodeType(index, op.type);
      if (op.laneId !== undefined) next.laneId = requireLane(graph, index, op.laneId).id;
      setOrClearText(next, "description", op.description, MAX_DESCRIPTION_LENGTH, index);
      setOrClearText(next, "owner", op.owner, MAX_OWNER_LENGTH, index);
      setOrClearText(next, "system", op.system, MAX_SYSTEM_LENGTH, index);
      setOrClearText(next, "painPoints", op.painPoints, MAX_PAIN_POINTS_LENGTH, index);
      setOrClearList(next, "inputs", op.inputs, index);
      setOrClearList(next, "outputs", op.outputs, index);
      if (op.duration !== undefined) {
        if (op.duration === null) delete next.duration;
        else next.duration = requireDuration(index, op.duration);
      }
      graph.nodes.set(node.id, next);
      return;
    }
    case "moveNode": {
      const node = requireNode(graph, index, op.id);
      graph.nodes.set(node.id, {
        ...node,
        x: requireCoordinate(index, op.x, "x"),
        y: requireCoordinate(index, op.y, "y"),
      });
      return;
    }
    case "deleteNode": {
      const node = requireNode(graph, index, op.id);
      requireUnlockedNode(graph, index, node.id);
      const incident = [...graph.edges.values()].filter(
        (edge) => edge.source === node.id || edge.target === node.id,
      );
      for (const edge of incident) requireUnlockedEdge(graph, index, edge.id);
      for (const edge of incident) graph.edges.delete(edge.id);
      graph.nodes.delete(node.id);
      return;
    }
    case "addEdge": {
      const input = requireObject(index, op.edge, "edge");
      const id = requireId(index, input.id, "Edge ID");
      if (graph.edges.has(id)) throw new GraphOpError(index, `Edge "${id}" already exists.`);
      const source = requireNode(graph, index, input.source).id;
      const target = requireNode(graph, index, input.target).id;
      const edge: ProcessEdge = { id, source, target };
      if (input.label !== undefined) {
        const label = requireLabel(index, input.label, "Edge label");
        if (label !== "") edge.label = label;
      }
      graph.edges.set(id, edge);
      return;
    }
    case "updateEdge": {
      const edge = requireEdge(graph, index, op.id);
      requireUnlockedEdge(graph, index, edge.id);
      if (op.label === undefined) return;
      const label = requireLabel(index, op.label, "Edge label");
      const { label: _previous, ...rest } = edge;
      graph.edges.set(edge.id, label === "" ? rest : { ...rest, label });
      return;
    }
    case "deleteEdge": {
      const edge = requireEdge(graph, index, op.id);
      requireUnlockedEdge(graph, index, edge.id);
      graph.edges.delete(edge.id);
      return;
    }
    default:
      throw new GraphOpError(index, `Unknown op "${String((op as { op?: unknown }).op)}".`);
  }
}

function autoPlace(graph: WorkingGraph, laneId: string): { x: number; y: number } {
  let rightmost: ProcessNode | undefined;
  for (const node of graph.nodes.values()) {
    if (node.laneId === laneId && (rightmost === undefined || node.x > rightmost.x)) {
      rightmost = node;
    }
  }
  if (rightmost) {
    return { x: Math.min(rightmost.x + NODE_SPACING_X, MAX_COORDINATE), y: rightmost.y };
  }
  const laneIndex = [...graph.lanes.keys()].indexOf(laneId);
  return { x: FIRST_NODE_X, y: laneIndex * LANE_HEIGHT + LANE_PADDING_Y };
}

/**
 * Recomputes every step's position from the flow: left-to-right in topological order (ties broken
 * by insertion order), each kept in its own lane's row. A cycle leaves some steps unordered by the
 * flow; they are placed after every step that could be ordered. Steps that land in the same lane
 * and column are stacked vertically so they don't overlap.
 */
export function layoutGraph(graph: ProcessGraph): ProcessGraph {
  const laneIndex = new Map(graph.lanes.map((lane, index) => [lane.id, index]));
  const outgoing = new Map<string, string[]>();
  const remainingInDegree = new Map<string, number>();
  for (const node of graph.nodes) {
    outgoing.set(node.id, []);
    remainingInDegree.set(node.id, 0);
  }
  for (const edge of graph.edges) {
    outgoing.get(edge.source)?.push(edge.target);
    remainingInDegree.set(edge.target, (remainingInDegree.get(edge.target) ?? 0) + 1);
  }
  const column = new Map<string, number>();
  const queue: string[] = [];
  for (const node of graph.nodes) {
    if ((remainingInDegree.get(node.id) ?? 0) === 0) {
      column.set(node.id, 0);
      queue.push(node.id);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    const next = (column.get(id) ?? 0) + 1;
    for (const target of outgoing.get(id) ?? []) {
      if (next > (column.get(target) ?? -1)) column.set(target, next);
      const remaining = (remainingInDegree.get(target) ?? 0) - 1;
      remainingInDegree.set(target, remaining);
      if (remaining === 0) queue.push(target);
    }
  }
  let overflow = Math.max(-1, ...column.values()) + 1;
  for (const node of graph.nodes) {
    if (!column.has(node.id)) column.set(node.id, overflow++);
  }
  const stack = new Map<string, number>();
  const nodes = graph.nodes.map((node) => {
    const key = `${node.laneId}:${column.get(node.id)}`;
    const offset = stack.get(key) ?? 0;
    stack.set(key, offset + 1);
    return {
      ...node,
      x: FIRST_NODE_X + (column.get(node.id) ?? 0) * NODE_SPACING_X,
      y: (laneIndex.get(node.laneId) ?? 0) * LANE_HEIGHT + LANE_PADDING_Y + offset * STACK_OFFSET_Y,
    };
  });
  return { ...graph, nodes };
}

function requireObject<T>(index: number, value: T, what: string): T {
  if (typeof value !== "object" || value === null) {
    throw new GraphOpError(index, `Missing ${what}.`);
  }
  return value;
}

function requireId(index: number, value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH ||
      !ID_PATTERN.test(value)) {
    throw new GraphOpError(
      index,
      `${what} must be 1-${MAX_ID_LENGTH} characters of letters, digits, "_" or "-".`,
    );
  }
  return value;
}

function requireLabel(index: number, value: unknown, what: string): string {
  if (typeof value !== "string") throw new GraphOpError(index, `${what} must be a string.`);
  if (value.length > MAX_LABEL_LENGTH) {
    throw new GraphOpError(index, `${what} must be at most ${MAX_LABEL_LENGTH} characters.`);
  }
  return value;
}

function requireLaneLabel(index: number, value: unknown): string {
  const label = requireLabel(index, value, "Lane label");
  if (label.trim() === "") throw new GraphOpError(index, "Lane label must not be empty.");
  return label;
}

function requireNodeType(index: number, value: unknown): ProcessNodeType {
  if (typeof value !== "string" || !NODE_TYPES.has(value)) {
    throw new GraphOpError(index, `Unknown node type "${String(value)}".`);
  }
  return value as ProcessNodeType;
}

function requireCoordinate(index: number, value: unknown, axis: "x" | "y"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) {
    throw new GraphOpError(index, `${axis} must be a finite number within ±${MAX_COORDINATE}.`);
  }
  return value;
}
function requireBoundedText(index: number, value: unknown, max: number, what: string): string {
  if (typeof value !== "string") throw new GraphOpError(index, `${what} must be a string.`);
  if (value.length > max) throw new GraphOpError(index, `${what} must be at most ${max} characters.`);
  return value;
}

function requireBoundedList(index: number, value: unknown, what: string): string[] {
  if (!Array.isArray(value)) throw new GraphOpError(index, `${what} must be an array of strings.`);
  if (value.length > MAX_LIST_ITEMS) {
    throw new GraphOpError(index, `${what} may have at most ${MAX_LIST_ITEMS} items.`);
  }
  return value.map((item, i) => {
    if (typeof item !== "string" || item.length > MAX_LIST_ITEM_LENGTH) {
      throw new GraphOpError(index, `${what}[${i}] must be a string of at most ${MAX_LIST_ITEM_LENGTH} characters.`);
    }
    return item;
  });
}

function requireDuration(index: number, value: unknown): StepDuration {
  if (typeof value !== "object" || value === null) throw new GraphOpError(index, "Duration must be an object.");
  const { amount, unit } = value as { amount?: unknown; unit?: unknown };
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > MAX_DURATION_AMOUNT) {
    throw new GraphOpError(index, `Duration amount must be a positive number up to ${MAX_DURATION_AMOUNT}.`);
  }
  if (unit !== "minutes" && unit !== "hours" && unit !== "days") {
    throw new GraphOpError(index, 'Duration unit must be "minutes", "hours", or "days".');
  }
  return { amount, unit };
}

// `null` clears the field, `undefined` leaves it unchanged, otherwise it is validated and set.
function setOrClearText<K extends "description" | "owner" | "system" | "painPoints">(
  node: ProcessNode,
  key: K,
  value: string | null | undefined,
  max: number,
  index: number,
): void {
  if (value === undefined) return;
  if (value === null) delete node[key];
  else node[key] = requireBoundedText(index, value, max, key);
}

function setOrClearList<K extends "inputs" | "outputs">(
  node: ProcessNode,
  key: K,
  value: string[] | null | undefined,
  index: number,
): void {
  if (value === undefined) return;
  if (value === null) delete node[key];
  else node[key] = requireBoundedList(index, value, key);
}
function requireLane(graph: WorkingGraph, index: number, id: unknown): ProcessLane {
  const lane = typeof id === "string" ? graph.lanes.get(id) : undefined;
  if (!lane) throw new GraphOpError(index, `Lane "${String(id)}" does not exist.`);
  return lane;
}

function requireNode(graph: WorkingGraph, index: number, id: unknown): ProcessNode {
  const node = typeof id === "string" ? graph.nodes.get(id) : undefined;
  if (!node) throw new GraphOpError(index, `Node "${String(id)}" does not exist.`);
  return node;
}

function requireEdge(graph: WorkingGraph, index: number, id: unknown): ProcessEdge {
  const edge = typeof id === "string" ? graph.edges.get(id) : undefined;
  if (!edge) throw new GraphOpError(index, `Edge "${String(id)}" does not exist.`);
  return edge;
}

function requireUnlockedNode(graph: WorkingGraph, index: number, id: string): void {
  if (!graph.allowLocked && graph.lockedNodes.has(id)) {
    throw new GraphOpError(index, `Node "${id}" is locked by an active decision.`);
  }
}

function requireUnlockedEdge(graph: WorkingGraph, index: number, id: string): void {
  if (!graph.allowLocked && graph.lockedEdges.has(id)) {
    throw new GraphOpError(index, `Edge "${id}" is locked by an active decision.`);
  }
}
