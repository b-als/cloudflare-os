import { applyGraphOps, type GraphOpOptions } from "./graph-ops.js";
import type {
  BaArtifact, BaBaselineContent, BaLifecycle, BaValidationIssue, LifecycleOp, ProcessGraph,
} from "./types.js";

/** Empty lifecycle for legacy projects. Their existing graph remains untouched. */
export function emptyLifecycle(revision = 0): BaLifecycle {
  return { contentRevision: revision, artifacts: [], toBe: { revision: 0, lanes: [], nodes: [], edges: [] }, baselines: [] };
}

function text(value: string, label: string, required = false): void {
  if (value.length > 4000 || (required && !value.trim())) {
    throw new Error(`${label} must ${required ? "be non-empty and " : ""}be at most 4000 characters.`);
  }
}

function id(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`Invalid artifact ID "${value}".`);
}

function strings(values: string[], label: string): void {
  if (values.length > 100) throw new Error(`${label} may contain at most 100 entries.`);
  for (const value of values) text(value, label, true);
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
}

function scale(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error(`${label} must be a whole number from 1 to 5.`);
  }
}

function checkArtifact(artifact: BaArtifact): void {
  id(artifact.id);
  text(artifact.title, "Title", true);
  switch (artifact.kind) {
    case "outcome":
      text(artifact.metric, "Metric");
      text(artifact.unit, "Unit");
      if (artifact.baseline !== null) finite(artifact.baseline, "Baseline");
      if (artifact.target !== null) finite(artifact.target, "Target");
      if (artifact.statement !== undefined) text(artifact.statement, "Statement");
      if (artifact.due !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(artifact.due)) {
        throw new Error("Due date must be a YYYY-MM-DD date.");
      }
      break;
    case "stakeholder":
      text(artifact.role, "Role");
      text(artifact.notes, "Notes");
      if (artifact.influence !== undefined) scale(artifact.influence, "Influence");
      if (artifact.interest !== undefined) scale(artifact.interest, "Interest");
      if (artifact.stance !== undefined && !["champion", "supporter", "neutral", "sceptic"].includes(artifact.stance)) {
        throw new Error("Stance must be champion, supporter, neutral or sceptic.");
      }
      break;
    case "requirement":
      text(artifact.statement, "Statement");
      text(artifact.source, "Source");
      strings(artifact.acceptanceCriteria, "Acceptance criteria");
      strings(artifact.outcomeIds, "Outcome IDs");
      strings(artifact.stakeholderIds, "Stakeholder IDs");
      strings(artifact.nodeIds, "Node IDs");
      break;
    case "tradeoff":
      strings(artifact.options, "Options");
      strings(artifact.requirementIds, "Requirement IDs");
      text(artifact.selection, "Selection");
      text(artifact.rationale, "Rationale");
      if (artifact.selection && !artifact.options.includes(artifact.selection)) {
        throw new Error("The selected option must be one of the alternatives.");
      }
      break;
    case "scenario":
      strings(artifact.requirementIds, "Requirement IDs");
      strings(artifact.pathNodeIds, "Path IDs");
      text(artifact.expected, "Expected result");
      text(artifact.actual, "Actual result");
      if (artifact.status !== "untested" && !artifact.actual.trim()) {
        throw new Error("A tested scenario must record its actual result.");
      }
      break;
    case "finding":
      text(artifact.scenarioId, "Scenario ID");
      text(artifact.resolution, "Resolution");
      if (artifact.status === "resolved" && !artifact.resolution.trim()) {
        throw new Error("A resolved finding must record its resolution.");
      }
      break;
    case "measurement":
      text(artifact.outcomeId, "Outcome ID", true);
      text(artifact.source, "Measurement source", true);
      finite(artifact.value, "Measurement");
      finite(artifact.measuredAt, "Measurement time");
      if (artifact.measuredAt <= 0 || artifact.measuredAt > Date.now()) {
        throw new Error("Measurement time must be a real, non-future timestamp.");
      }
      break;
    case "handoff":
      strings(artifact.requirementIds, "Requirement IDs");
      text(artifact.owner, "Owner");
      text(artifact.description, "Description");
      break;
  }
}

function checkReferences(artifacts: BaArtifact[], graph: ProcessGraph): void {
  const lookup = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const nodes = new Set(graph.nodes.map((node) => node.id));
  const references = (ids: string[], kind: BaArtifact["kind"]) => {
    for (const reference of ids) {
      if (lookup.get(reference)?.kind !== kind) throw new Error(`Unknown ${kind} reference "${reference}".`);
    }
  };
  for (const artifact of artifacts) {
    switch (artifact.kind) {
      case "requirement":
        references(artifact.outcomeIds, "outcome");
        references(artifact.stakeholderIds, "stakeholder");
        for (const nodeId of artifact.nodeIds) {
          if (!nodes.has(nodeId)) throw new Error(`Unknown target step reference "${nodeId}".`);
        }
        break;
      case "scenario":
        references(artifact.requirementIds, "requirement");
        for (let index = 0; index < artifact.pathNodeIds.length; index++) {
          const nodeId = artifact.pathNodeIds[index]!;
          if (!nodes.has(nodeId)) throw new Error(`Unknown target step reference "${nodeId}".`);
          if (index > 0 && !graph.edges.some((edge) =>
            edge.source === artifact.pathNodeIds[index - 1] && edge.target === nodeId)) {
            throw new Error(`Scenario path has no flow into "${nodeId}".`);
          }
        }
        break;
      case "tradeoff":
      case "handoff":
        references(artifact.requirementIds, "requirement");
        break;
      case "finding":
        if (artifact.scenarioId) references([artifact.scenarioId], "scenario");
        break;
      case "measurement":
        references([artifact.outcomeId], "outcome");
        break;
    }
  }
}

/** Validate and apply one atomic lifecycle edit without mutating the input or captured baselines. */
export function applyLifecycleOps(
  state: BaLifecycle, ops: LifecycleOp[], modelOps: Parameters<typeof applyGraphOps>[1] = [],
  graphOptions: GraphOpOptions = {},
): BaLifecycle {
  if (ops.length + modelOps.length === 0) throw new Error("A lifecycle batch must contain at least one edit.");
  if (ops.length > 200) throw new Error("A batch may contain at most 200 artifact edits.");
  const artifacts = new Map(state.artifacts.map((artifact) => [artifact.id, artifact]));
  for (const op of ops) {
    if (op.op === "putArtifact") {
      checkArtifact(op.artifact);
      const previous = artifacts.get(op.artifact.id);
      if (previous && previous.kind !== op.artifact.kind) throw new Error("An artifact's kind cannot change.");
      artifacts.set(op.artifact.id, structuredClone(op.artifact));
    } else {
      if (!artifacts.delete(op.id)) throw new Error(`Artifact "${op.id}" does not exist.`);
    }
  }
  if (artifacts.size > 200) throw new Error("A project may contain at most 200 artifacts.");
  const toBe = modelOps.length
    ? { ...applyGraphOps(state.toBe, modelOps, graphOptions), revision: state.toBe.revision + 1 }
    : state.toBe;
  const next = { ...state, artifacts: [...artifacts.values()], toBe };
  checkReferences(next.artifacts, toBe);
  if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 2_000_000) {
    throw new Error("The lifecycle exceeds its 2 MB limit.");
  }
  return next;
}

function graphIssues(graph: ProcessGraph, model: string): BaValidationIssue[] {
  const issues: BaValidationIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message: `${model}: ${message}` });
  const starts = graph.nodes.filter((node) => node.type === "startEvent");
  const ends = graph.nodes.filter((node) => node.type === "endEvent");
  if (!starts.length || !ends.length) add("graph.events", "Add at least one start and end event.");
  const walk = (initial: string[], reverse: boolean) => {
    const reached = new Set(initial);
    const pending = [...initial];
    while (pending.length) {
      const current = pending.pop();
      for (const edge of graph.edges) {
        if ((reverse ? edge.target : edge.source) !== current) continue;
        const next = reverse ? edge.source : edge.target;
        if (!reached.has(next)) { reached.add(next); pending.push(next); }
      }
    }
    return reached;
  };
  const fromStart = walk(starts.map((node) => node.id), false);
  const toEnd = walk(ends.map((node) => node.id), true);
  for (const node of graph.nodes) {
    if (!fromStart.has(node.id)) add("graph.unreachable", `"${node.label}" is unreachable from a start.`);
    if (!toEnd.has(node.id)) add("graph.deadend", `"${node.label}" has no path to an end.`);
    if (node.type.endsWith("Task") && !node.owner?.trim()) add("graph.owner", `"${node.label}" needs an owner.`);
    if (node.type === "startEvent" && graph.edges.some((edge) => edge.target === node.id)) {
      add("graph.start", `"${node.label}" is a start event with an incoming flow.`);
    }
    if (node.type === "endEvent" && graph.edges.some((edge) => edge.source === node.id)) {
      add("graph.end", `"${node.label}" is an end event with an outgoing flow.`);
    }
    if (node.type.endsWith("Gateway")) {
      const branches = graph.edges.filter((edge) => edge.source === node.id);
      const incoming = graph.edges.filter((edge) => edge.target === node.id);
      if (branches.length < 2 && incoming.length < 2) add("graph.branches", `"${node.label}" needs multiple split or merge paths.`);
      if (node.type === "exclusiveGateway" && branches.length > 1 && branches.some((edge) => !edge.label?.trim())) {
        add("graph.conditions", `"${node.label}" needs conditions on every branch.`);
      }
    }
  }
  return issues;
}

/** Compute approval blockers from the actual captured content, never from a user-supplied flag. */
export function validateBaseline(content: BaBaselineContent): BaValidationIssue[] {
  const issues = [...graphIssues(content.asIs, "As-is"), ...graphIssues(content.toBe, "To-be")];
  const add = (code: string, message: string, artifactId?: string) => issues.push({ code, message, artifactId });
  const outcomes = content.artifacts.filter((artifact) => artifact.kind === "outcome");
  if (!outcomes.length) add("outcomes.missing", "Define at least one measurable outcome.");
  for (const outcome of outcomes) {
    if (!outcome.metric.trim() || !outcome.unit.trim() || outcome.baseline === null || outcome.target === null) {
      add("outcomes.measure", `"${outcome.title}" needs a metric, unit, baseline and target.`, outcome.id);
    }
  }
  if (!content.artifacts.some((artifact) => artifact.kind === "stakeholder" && artifact.role.trim())) {
    add("stakeholders.missing", "Record at least one stakeholder and their role.");
  }
  const requirements = content.artifacts.filter((artifact) => artifact.kind === "requirement")
    .filter((requirement) => requirement.priority !== "wont");
  if (!requirements.length) add("requirements.missing", "Record at least one in-scope requirement.");
  for (const outcome of outcomes) {
    if (!requirements.some((requirement) => requirement.outcomeIds.includes(outcome.id))) {
      add("outcomes.trace", `"${outcome.title}" has no delivering requirement.`, outcome.id);
    }
  }
  for (const requirement of requirements) {
    if (!requirement.statement.trim() || !requirement.acceptanceCriteria.length || !requirement.source.trim() ||
        !requirement.outcomeIds.length || !requirement.stakeholderIds.length || !requirement.nodeIds.length) {
      add("requirements.trace", `"${requirement.title}" needs its statement, criteria, source and outcome/stakeholder/step links.`, requirement.id);
    }
    const passed = content.artifacts.filter((artifact) => artifact.kind === "scenario")
      .filter((scenario) => scenario.requirementIds.includes(requirement.id) && scenario.status === "passed" &&
        scenario.expected.trim() && scenario.actual.trim() &&
        content.toBe.nodes.some((node) => node.id === scenario.pathNodeIds[0] && node.type === "startEvent") &&
        content.toBe.nodes.some((node) => node.id === scenario.pathNodeIds.at(-1) && node.type === "endEvent"));
    const testedSteps = new Set(passed.flatMap((scenario) => scenario.pathNodeIds));
    if (!passed.length || requirement.nodeIds.some((nodeId) => !testedSteps.has(nodeId))) {
      add("validation.coverage", `"${requirement.title}" needs a passing, evidenced validation scenario.`, requirement.id);
    }
  }
  for (const artifact of content.artifacts) {
    if (artifact.kind === "finding" && artifact.severity === "blocking" && artifact.status === "open") {
      add("findings.blocking", `"${artifact.title}" is an unresolved blocking finding.`, artifact.id);
    }
    if (artifact.kind === "scenario" && artifact.status === "failed") {
      add("validation.failed", `"${artifact.title}" is a failed validation scenario.`, artifact.id);
    }
    if (artifact.kind === "tradeoff" && (artifact.options.length < 2 || !artifact.selection.trim() ||
        !artifact.rationale.trim() || !artifact.requirementIds.length)) {
      add("tradeoff.unresolved", `"${artifact.title}" needs a selection and rationale.`, artifact.id);
    }
    if (artifact.kind === "stakeholder" && !artifact.role.trim()) {
      add("stakeholder.role", `"${artifact.title}" needs a role.`, artifact.id);
    }
    if (artifact.kind === "handoff" && (!artifact.owner.trim() || !artifact.description.trim() || !artifact.requirementIds.length)) {
      add("handoff.incomplete", `"${artifact.title}" needs an owner, implementation description and requirement links.`, artifact.id);
    }
  }
  if (content.openQuestions.length) add("questions.open", "Resolve open stakeholder questions before sign-off.");
  return issues;
}
