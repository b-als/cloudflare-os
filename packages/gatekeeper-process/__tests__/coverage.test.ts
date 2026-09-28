import { describe, expect, it } from "vitest";
import { computeCoverage } from "../src/coverage.js";
import type { ProcessGraph } from "../src/types.js";

function graph(overrides: Partial<ProcessGraph>): ProcessGraph {
  return { revision: 0, lanes: [{ id: "ops", label: "Ops" }], nodes: [], edges: [], ...overrides };
}

function done(graph_: ProcessGraph) {
  const items = computeCoverage(graph_);
  return Object.fromEntries(items.map((i) => [i.key, i.done]));
}

describe("computeCoverage", () => {
  it("is entirely undone for an empty graph", () => {
    expect(done(graph({}))).toEqual({
      scope: false, happyPath: false, exceptions: false,
      rolesAndSystems: false, painPoints: false, measures: false,
    });
  });

  it("marks scope and happy path once start reaches end", () => {
    const g = graph({
      nodes: [
        { id: "start", type: "startEvent", label: "Start", laneId: "ops", x: 0, y: 0 },
        { id: "end", type: "endEvent", label: "End", laneId: "ops", x: 100, y: 0 },
      ],
      edges: [{ id: "e1", source: "start", target: "end" }],
    });
    expect(done(g)).toMatchObject({ scope: true, happyPath: true, exceptions: false });
  });

  it("does not mark happy path done when start and end are disconnected", () => {
    const g = graph({
      nodes: [
        { id: "start", type: "startEvent", label: "Start", laneId: "ops", x: 0, y: 0 },
        { id: "end", type: "endEvent", label: "End", laneId: "ops", x: 100, y: 0 },
      ],
      edges: [],
    });
    expect(done(g).happyPath).toBe(false);
  });

  it("marks exceptions done via a branching gateway or a second end event", () => {
    const gateway = graph({
      nodes: [{ id: "g", type: "exclusiveGateway", label: "?", laneId: "ops", x: 0, y: 0 }],
      edges: [{ id: "e1", source: "g", target: "a" }, { id: "e2", source: "g", target: "b" }],
    });
    expect(done(gateway).exceptions).toBe(true);

    const twoEnds = graph({
      nodes: [
        { id: "end1", type: "endEvent", label: "End", laneId: "ops", x: 0, y: 0 },
        { id: "end2", type: "endEvent", label: "End 2", laneId: "ops", x: 0, y: 0 },
      ],
    });
    expect(done(twoEnds).exceptions).toBe(true);
  });

  it("requires roles/systems on at least half of task steps", () => {
    const half = graph({
      nodes: [
        { id: "t1", type: "userTask", label: "A", laneId: "ops", x: 0, y: 0, owner: "Ops" },
        { id: "t2", type: "userTask", label: "B", laneId: "ops", x: 0, y: 0 },
      ],
    });
    expect(done(half).rolesAndSystems).toBe(true);

    const quarter = graph({
      nodes: [
        { id: "t1", type: "userTask", label: "A", laneId: "ops", x: 0, y: 0, owner: "Ops" },
        { id: "t2", type: "userTask", label: "B", laneId: "ops", x: 0, y: 0 },
        { id: "t3", type: "userTask", label: "C", laneId: "ops", x: 0, y: 0 },
        { id: "t4", type: "userTask", label: "D", laneId: "ops", x: 0, y: 0 },
      ],
    });
    expect(done(quarter).rolesAndSystems).toBe(false);
  });

  it("marks pain points and measures done once any step has them", () => {
    const g = graph({
      nodes: [
        { id: "t1", type: "userTask", label: "A", laneId: "ops", x: 0, y: 0, painPoints: "Slow" },
        { id: "t2", type: "userTask", label: "B", laneId: "ops", x: 0, y: 0, duration: { amount: 1, unit: "hours" } },
      ],
    });
    expect(done(g)).toMatchObject({ painPoints: true, measures: true });
  });
});
