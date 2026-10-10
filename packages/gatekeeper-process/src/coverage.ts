import type { CoverageItem, ProcessGraph } from "./types.js";

export type { CoverageItem, CoverageKey } from "./types.js";

const TASK_TYPES = new Set(["userTask", "serviceTask", "manualTask"]);

// Whether any start event can reach any end event by following edges forward.
function reachesEnd(graph: ProcessGraph): boolean {
  const starts = graph.nodes.filter((n) => n.type === "startEvent").map((n) => n.id);
  const ends = new Set(graph.nodes.filter((n) => n.type === "endEvent").map((n) => n.id));
  if (starts.length === 0 || ends.size === 0) return false;
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const targets = outgoing.get(edge.source);
    if (targets) targets.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (ends.has(id)) return true;
    for (const next of outgoing.get(id) ?? []) stack.push(next);
  }
  return false;
}

/**
 * A lightweight elicitation checklist computed from the graph alone: it looks for signs that a
 * standard BA question has been covered, rather than asking the user to track it by hand.
 */
export function computeCoverage(graph: ProcessGraph): CoverageItem[] {
  const outgoingCount = new Map<string, number>();
  for (const edge of graph.edges) outgoingCount.set(edge.source, (outgoingCount.get(edge.source) ?? 0) + 1);
  const hasBranchingGateway = graph.nodes.some(
    (n) => (n.type === "exclusiveGateway" || n.type === "parallelGateway") && (outgoingCount.get(n.id) ?? 0) >= 2,
  );
  const endEventCount = graph.nodes.filter((n) => n.type === "endEvent").length;
  const taskNodes = graph.nodes.filter((n) => TASK_TYPES.has(n.type));
  const withRoleOrSystem = taskNodes.filter((n) => n.owner || n.system).length;

  return [
    {
      key: "scope",
      label: "Scope: start and end are defined",
      done: graph.nodes.some((n) => n.type === "startEvent") && endEventCount > 0,
      hint: "Add a start event and at least one end event to mark the process boundaries.",
    },
    {
      key: "happyPath",
      label: "Happy path: start connects to an end",
      done: reachesEnd(graph),
      hint: "Connect the steps from the start event through to an end event.",
    },
    {
      key: "exceptions",
      label: "Exceptions: branches or alternate outcomes",
      done: hasBranchingGateway || endEventCount >= 2,
      hint: "Ask what can go wrong or branch, and add a gateway or alternate outcome.",
    },
    {
      key: "rolesAndSystems",
      label: "Roles/systems: who does each step, with what",
      done: taskNodes.length > 0 && withRoleOrSystem / taskNodes.length >= 0.5,
      hint: "Ask who performs each step and which tool or system they use.",
    },
    {
      key: "painPoints",
      label: "Pain points: known friction is captured",
      done: graph.nodes.some((n) => !!n.painPoints),
      hint: "Ask what's slow, manual, or error-prone today.",
    },
    {
      key: "measures",
      label: "Measures: timing or success criteria",
      done: graph.nodes.some((n) => !!n.duration),
      hint: "Ask how long a step takes, or what marks the process as successful.",
    },
  ];
}
