import { describe, expect, it } from "vitest";
import {
  applyGraphOps,
  diffGraphs,
  FIRST_NODE_X,
  GraphOpError,
  LANE_HEIGHT,
  LANE_PADDING_Y,
  layoutGraph,
  MAX_ID_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_LIST_ITEMS,
  MAX_OPS_PER_BATCH,
  NODE_SPACING_X,
  STACK_OFFSET_Y,
  touchedElementIds,
} from "../src/graph-ops.js";
import type { GraphOp, ProcessGraph } from "../src/types.js";

function baseGraph(): ProcessGraph {
  return {
    revision: 3,
    lanes: [
      { id: "sales", label: "Sales" },
      { id: "ops", label: "Operations" },
    ],
    nodes: [
      { id: "start", type: "startEvent", label: "Start", laneId: "sales", x: 80, y: 60 },
      { id: "review", type: "userTask", label: "Review", laneId: "sales", x: 280, y: 60 },
      { id: "ship", type: "manualTask", label: "Ship", laneId: "ops", x: 280, y: 220 },
    ],
    edges: [
      { id: "e1", source: "start", target: "review" },
      { id: "e2", source: "review", target: "ship", label: "Approved" },
    ],
  };
}

function expectError(fn: () => unknown, message: RegExp, opIndex?: number): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(GraphOpError);
  expect((caught as GraphOpError).message).toMatch(message);
  if (opIndex !== undefined) expect((caught as GraphOpError).opIndex).toBe(opIndex);
}

describe("applyGraphOps", () => {
  it("does not mutate the input and keeps the revision", () => {
    const graph = baseGraph();
    const before = structuredClone(graph);
    const next = applyGraphOps(graph, [{ op: "renameLane", id: "sales", label: "Sales team" }]);
    expect(graph).toEqual(before);
    expect(next.revision).toBe(3);
    expect(next.lanes[0]).toEqual({ id: "sales", label: "Sales team" });
  });

  it("applies every op kind", () => {
    const ops: GraphOp[] = [
      { op: "addLane", lane: { id: "finance", label: "Finance" } },
      { op: "addNode", node: { id: "bill", type: "serviceTask", label: "Bill", laneId: "finance", x: 400, y: 380 } },
      { op: "addEdge", edge: { id: "e3", source: "ship", target: "bill", label: "Shipped" } },
      { op: "updateNode", id: "review", label: "Review order", type: "manualTask", laneId: "ops" },
      { op: "moveNode", id: "start", x: 10, y: 20 },
      { op: "updateEdge", id: "e2", label: "" },
      { op: "deleteEdge", id: "e1" },
    ];
    const next = applyGraphOps(baseGraph(), ops);
    expect(next.lanes.map((lane) => lane.id)).toEqual(["sales", "ops", "finance"]);
    expect(next.nodes.find((node) => node.id === "review")).toMatchObject({
      label: "Review order", type: "manualTask", laneId: "ops",
    });
    expect(next.nodes.find((node) => node.id === "start")).toMatchObject({ x: 10, y: 20 });
    expect(next.edges).toEqual([
      { id: "e2", source: "review", target: "ship" },
      { id: "e3", source: "ship", target: "bill", label: "Shipped" },
    ]);
  });

  it("rejects duplicate IDs, including ones added earlier in the batch", () => {
    expectError(() => applyGraphOps(baseGraph(), [
      { op: "addNode", node: { id: "start", type: "userTask", label: "x", laneId: "sales" } },
    ]), /Node "start" already exists/, 0);
    expectError(() => applyGraphOps(baseGraph(), [
      { op: "addLane", lane: { id: "new", label: "New" } },
      { op: "addLane", lane: { id: "new", label: "Again" } },
    ]), /Lane "new" already exists/, 1);
    expectError(() => applyGraphOps(baseGraph(), [
      { op: "addEdge", edge: { id: "e1", source: "start", target: "ship" } },
    ]), /Edge "e1" already exists/);
  });

  it("resolves references to elements added earlier in the same batch", () => {
    const next = applyGraphOps(baseGraph(), [
      { op: "addLane", lane: { id: "qa", label: "QA" } },
      { op: "addNode", node: { id: "check", type: "userTask", label: "Check", laneId: "qa" } },
      { op: "addEdge", edge: { id: "e9", source: "ship", target: "check" } },
      { op: "updateEdge", id: "e9", label: "Always" },
    ]);
    expect(next.edges.at(-1)).toEqual({ id: "e9", source: "ship", target: "check", label: "Always" });
  });

  it("rejects unknown references", () => {
    expectError(() => applyGraphOps(baseGraph(), [{ op: "renameLane", id: "nope", label: "X" }]),
      /Lane "nope" does not exist/);
    expectError(() => applyGraphOps(baseGraph(), [{ op: "updateNode", id: "nope", label: "X" }]),
      /Node "nope" does not exist/);
    expectError(() => applyGraphOps(baseGraph(), [{ op: "moveNode", id: "nope", x: 1, y: 1 }]),
      /Node "nope" does not exist/);
    expectError(() => applyGraphOps(baseGraph(), [{ op: "deleteEdge", id: "nope" }]),
      /Edge "nope" does not exist/);
    expectError(() => applyGraphOps(baseGraph(), [
      { op: "addNode", node: { id: "n", type: "userTask", label: "x", laneId: "nope" } },
    ]), /Lane "nope" does not exist/);
    expectError(() => applyGraphOps(baseGraph(), [{ op: "updateNode", id: "start", laneId: "nope" }]),
      /Lane "nope" does not exist/);
  });

  it("rejects dangling edge endpoints", () => {
    expectError(() => applyGraphOps(baseGraph(), [
      { op: "addEdge", edge: { id: "e9", source: "start", target: "ghost" } },
    ]), /Node "ghost" does not exist/);
    expectError(() => applyGraphOps(baseGraph(), [
      { op: "deleteNode", id: "ship" },
      { op: "addEdge", edge: { id: "e9", source: "start", target: "ship" } },
    ]), /Node "ship" does not exist/, 1);
  });

  it("rejects unknown node types and op kinds", () => {
    expectError(() => applyGraphOps(baseGraph(), [
      { op: "addNode", node: { id: "n", type: "subProcess" as never, label: "x", laneId: "sales" } },
    ]), /Unknown node type "subProcess"/);
    expectError(() => applyGraphOps(baseGraph(), [{ op: "updateNode", id: "start", type: "bogus" as never }]),
      /Unknown node type/);
    expectError(() => applyGraphOps(baseGraph(), [{ op: "explode" } as never]), /Unknown op "explode"/);
  });

  it("cascades node deletion to incident edges", () => {
    const next = applyGraphOps(baseGraph(), [{ op: "deleteNode", id: "review" }]);
    expect(next.nodes.map((node) => node.id)).toEqual(["start", "ship"]);
    expect(next.edges).toEqual([]);
  });

  it("deletes only empty lanes", () => {
    expectError(() => applyGraphOps(baseGraph(), [{ op: "deleteLane", id: "ops" }]),
      /Lane "ops" is not empty; it contains "ship"/);
    const next = applyGraphOps(baseGraph(), [
      { op: "deleteNode", id: "ship" },
      { op: "deleteLane", id: "ops" },
    ]);
    expect(next.lanes.map((lane) => lane.id)).toEqual(["sales"]);
  });

  it("enforces ID format and length", () => {
    for (const id of ["", "has space", "slash/", "a".repeat(MAX_ID_LENGTH + 1)]) {
      expectError(() => applyGraphOps(baseGraph(), [{ op: "addLane", lane: { id, label: "X" } }]),
        /Lane ID must be/);
    }
    const ok = applyGraphOps(baseGraph(), [
      { op: "addLane", lane: { id: `A-z_9${"b".repeat(MAX_ID_LENGTH - 5)}`, label: "X" } },
    ]);
    expect(ok.lanes).toHaveLength(3);
  });

  it("enforces label limits", () => {
    const long = "x".repeat(MAX_LABEL_LENGTH + 1);
    expectError(() => applyGraphOps(baseGraph(), [{ op: "renameLane", id: "sales", label: long }]),
      /at most 200 characters/);
    expectError(() => applyGraphOps(baseGraph(), [{ op: "renameLane", id: "sales", label: "  " }]),
      /Lane label must not be empty/);
    expectError(() => applyGraphOps(baseGraph(), [{ op: "updateNode", id: "start", label: long }]),
      /Node label must be at most/);
    expectError(() => applyGraphOps(baseGraph(), [{ op: "updateEdge", id: "e1", label: long }]),
      /Edge label must be at most/);
    const next = applyGraphOps(baseGraph(), [
      { op: "updateNode", id: "start", label: "x".repeat(MAX_LABEL_LENGTH) },
    ]);
    expect(next.nodes[0]?.label).toHaveLength(MAX_LABEL_LENGTH);
  });

  it("requires finite coordinates", () => {
    for (const x of [Number.NaN, Number.POSITIVE_INFINITY, 1e9]) {
      expectError(() => applyGraphOps(baseGraph(), [{ op: "moveNode", id: "start", x, y: 0 }]),
        /x must be a finite number/);
    }
    expectError(() => applyGraphOps(baseGraph(), [
      { op: "addNode", node: { id: "n", type: "userTask", label: "", laneId: "sales", y: Number.NaN } },
    ]), /y must be a finite number/);
  });

  it("rejects oversized batches", () => {
    const ops: GraphOp[] = Array.from({ length: MAX_OPS_PER_BATCH + 1 }, () => (
      { op: "moveNode", id: "start", x: 0, y: 0 }
    ));
    expectError(() => applyGraphOps(baseGraph(), ops), /at most 500 ops/, -1);
  });

  it("auto-places nodes right of the lane's rightmost node, or at the lane's start", () => {
    const next = applyGraphOps(baseGraph(), [
      { op: "addNode", node: { id: "a", type: "userTask", label: "A", laneId: "sales" } },
      { op: "addNode", node: { id: "b", type: "userTask", label: "B", laneId: "sales" } },
      { op: "addLane", lane: { id: "empty", label: "Empty" } },
      { op: "addNode", node: { id: "c", type: "endEvent", label: "C", laneId: "empty" } },
      { op: "addNode", node: { id: "d", type: "endEvent", label: "D", laneId: "ops", x: 5 } },
    ]);
    const byId = new Map(next.nodes.map((node) => [node.id, node]));
    expect(byId.get("a")).toMatchObject({ x: 280 + NODE_SPACING_X, y: 60 });
    expect(byId.get("b")).toMatchObject({ x: 280 + 2 * NODE_SPACING_X, y: 60 });
    expect(byId.get("c")).toMatchObject({ x: FIRST_NODE_X, y: 2 * LANE_HEIGHT + LANE_PADDING_Y });
    expect(byId.get("d")).toMatchObject({ x: 5, y: 220 });
  });

  describe("locks", () => {
    const locks = { lockedNodeIds: ["review"], lockedEdgeIds: ["e2"] };

    it("blocks modifying or deleting locked elements", () => {
      expectError(() => applyGraphOps(baseGraph(), [{ op: "updateNode", id: "review", label: "X" }], locks),
        /Node "review" is locked/);
      expectError(() => applyGraphOps(baseGraph(), [{ op: "deleteNode", id: "review" }], locks),
        /Node "review" is locked/);
      expectError(() => applyGraphOps(baseGraph(), [{ op: "updateEdge", id: "e2", label: "X" }], locks),
        /Edge "e2" is locked/);
      expectError(() => applyGraphOps(baseGraph(), [{ op: "deleteEdge", id: "e2" }], locks),
        /Edge "e2" is locked/);
    });

    it("blocks cascading into a locked edge", () => {
      expectError(() => applyGraphOps(baseGraph(), [{ op: "deleteNode", id: "ship" }], locks),
        /Edge "e2" is locked/);
    });

    it("always allows moveNode and edits to unlocked elements", () => {
      const next = applyGraphOps(baseGraph(), [
        { op: "moveNode", id: "review", x: 1, y: 2 },
        { op: "updateNode", id: "start", label: "Begin" },
        { op: "addEdge", edge: { id: "e3", source: "review", target: "start" } },
      ], locks);
      expect(next.nodes.find((node) => node.id === "review")).toMatchObject({ x: 1, y: 2 });
    });

    it("permits locked edits when allowLocked is set", () => {
      const next = applyGraphOps(baseGraph(), [{ op: "deleteNode", id: "review" }],
        { ...locks, allowLocked: true });
      expect(next.edges).toEqual([]);
    });
  });
});

describe("touchedElementIds", () => {
  it("collects lane, node, and edge IDs", () => {
    const touched = touchedElementIds([
      { op: "addLane", lane: { id: "l1", label: "L" } },
      { op: "renameLane", id: "sales", label: "S" },
      { op: "deleteLane", id: "old" },
      { op: "addNode", node: { id: "n1", type: "userTask", label: "", laneId: "l1" } },
      { op: "updateNode", id: "start" },
      { op: "moveNode", id: "start", x: 0, y: 0 },
      { op: "addEdge", edge: { id: "e9", source: "n1", target: "start" } },
      { op: "updateEdge", id: "e1" },
      { op: "deleteEdge", id: "e1" },
    ]);
    expect(touched).toEqual({
      laneIds: ["l1", "sales", "old"],
      nodeIds: ["n1", "start"],
      edgeIds: ["e9", "e1"],
    });
  });

  it("includes cascaded edges when given the graph", () => {
    const ops: GraphOp[] = [{ op: "deleteNode", id: "review" }];
    expect(touchedElementIds(ops).edgeIds).toEqual([]);
    expect(touchedElementIds(ops, baseGraph()).edgeIds).toEqual(["e1", "e2"]);
  });

  it("skips malformed ops", () => {
    expect(touchedElementIds([null, { op: "addNode" }] as never)).toEqual({
      laneIds: [], nodeIds: [], edgeIds: [],
    });
  });
});

describe("diffGraphs", () => {
  it("classifies nodes and edges as added, removed, or changed", () => {
    const before = baseGraph();
    const after: ProcessGraph = {
      ...before,
      nodes: [
        before.nodes[0],
        { ...before.nodes[1], label: "Double-check" },
        { id: "pack", type: "manualTask", label: "Pack", laneId: "ops", x: 480, y: 220 },
      ],
      edges: [
        before.edges[0],
        { id: "e3", source: "review", target: "pack" },
      ],
    };
    expect(diffGraphs(before, after)).toEqual({
      addedNodeIds: ["pack"],
      removedNodeIds: ["ship"],
      changedNodeIds: ["review"],
      addedEdgeIds: ["e3"],
      removedEdgeIds: ["e2"],
      changedEdgeIds: [],
    });
  });

  it("ignores position-only moves", () => {
    const before = baseGraph();
    const after: ProcessGraph = {
      ...before,
      nodes: before.nodes.map((n) => (n.id === "review" ? { ...n, x: 999, y: 999 } : n)),
    };
    expect(diffGraphs(before, after)).toMatchObject({ addedNodeIds: [], removedNodeIds: [], changedNodeIds: [] });
  });

  it("is empty for identical graphs", () => {
    const graph = baseGraph();
    expect(diffGraphs(graph, graph)).toEqual({
      addedNodeIds: [], removedNodeIds: [], changedNodeIds: [],
      addedEdgeIds: [], removedEdgeIds: [], changedEdgeIds: [],
    });
  });
});

describe("step detail fields", () => {
  it("sets detail fields on addNode and keeps them across other edits", () => {
    const next = applyGraphOps(baseGraph(), [
      { op: "addNode", node: {
        id: "quote", type: "userTask", label: "Quote", laneId: "sales",
        description: "Draft a quote", owner: "Sales rep", system: "CRM",
        inputs: ["Customer brief"], outputs: ["Quote PDF"],
        duration: { amount: 2, unit: "hours" }, painPoints: "Often delayed",
      } },
      { op: "moveNode", id: "quote", x: 10, y: 10 },
    ]);
    expect(next.nodes.find((n) => n.id === "quote")).toMatchObject({
      description: "Draft a quote", owner: "Sales rep", system: "CRM",
      inputs: ["Customer brief"], outputs: ["Quote PDF"],
      duration: { amount: 2, unit: "hours" }, painPoints: "Often delayed",
    });
  });

  it("sets, changes, and clears detail fields with updateNode", () => {
    let graph = applyGraphOps(baseGraph(), [
      { op: "updateNode", id: "review", description: "Check the order", owner: "Ops",
        inputs: ["Order"], duration: { amount: 30, unit: "minutes" } },
    ]);
    expect(graph.nodes.find((n) => n.id === "review")).toMatchObject({
      description: "Check the order", owner: "Ops", inputs: ["Order"], duration: { amount: 30, unit: "minutes" },
    });
    graph = applyGraphOps(graph, [
      { op: "updateNode", id: "review", owner: "Compliance", inputs: null, duration: null },
    ]);
    const review = graph.nodes.find((n) => n.id === "review")!;
    expect(review.description).toBe("Check the order");
    expect(review.owner).toBe("Compliance");
    expect(review.inputs).toBeUndefined();
    expect(review.duration).toBeUndefined();
  });

  it("rejects an invalid duration", () => {
    expectError(
      () => applyGraphOps(baseGraph(), [{ op: "updateNode", id: "review", duration: { amount: -1, unit: "hours" } }]),
      /positive number/,
    );
    expectError(
      () => applyGraphOps(baseGraph(), [{ op: "updateNode", id: "review", duration: { amount: 1, unit: "weeks" } }]),
      /minutes.*hours.*days/,
    );
  });

  it("rejects an oversized list", () => {
    const inputs = Array.from({ length: MAX_LIST_ITEMS + 1 }, (_, i) => `item-${i}`);
    expectError(
      () => applyGraphOps(baseGraph(), [{ op: "updateNode", id: "review", inputs }]),
      /at most \d+ items/,
    );
  });
});

describe("layoutGraph", () => {
  it("orders steps left-to-right by flow and keeps each in its lane's row", () => {
    const laneIndex = new Map(baseGraph().lanes.map((lane, i) => [lane.id, i]));
    const laidOut = layoutGraph(baseGraph());
    const at = (id: string) => laidOut.nodes.find((n) => n.id === id)!;
    expect(at("start").x).toBe(FIRST_NODE_X);
    expect(at("review").x).toBe(FIRST_NODE_X + NODE_SPACING_X);
    expect(at("ship").x).toBe(FIRST_NODE_X + 2 * NODE_SPACING_X);
    for (const node of laidOut.nodes) {
      expect(node.y).toBe((laneIndex.get(node.laneId) ?? 0) * LANE_HEIGHT + LANE_PADDING_Y);
    }
  });

  it("stacks steps that land in the same lane and column", () => {
    const graph: ProcessGraph = {
      revision: 0,
      lanes: [{ id: "l1", label: "L1" }],
      nodes: [
        { id: "a", type: "startEvent", label: "A", laneId: "l1", x: 0, y: 0 },
        { id: "b", type: "userTask", label: "B", laneId: "l1", x: 0, y: 0 },
        { id: "c", type: "userTask", label: "C", laneId: "l1", x: 0, y: 0 },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "a", target: "c" },
      ],
    };
    const laidOut = layoutGraph(graph);
    const bY = laidOut.nodes.find((n) => n.id === "b")!.y;
    const cY = laidOut.nodes.find((n) => n.id === "c")!.y;
    expect(Math.abs(bY - cY)).toBe(STACK_OFFSET_Y);
  });

  it("still places every step when the flow has a cycle", () => {
    const graph: ProcessGraph = {
      revision: 0,
      lanes: [{ id: "l1", label: "L1" }],
      nodes: [
        { id: "a", type: "userTask", label: "A", laneId: "l1", x: 0, y: 0 },
        { id: "b", type: "userTask", label: "B", laneId: "l1", x: 0, y: 0 },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "a" },
      ],
    };
    const laidOut = layoutGraph(graph);
    expect(laidOut.nodes).toHaveLength(2);
    expect(new Set(laidOut.nodes.map((n) => n.x)).size).toBe(2);
  });
});
