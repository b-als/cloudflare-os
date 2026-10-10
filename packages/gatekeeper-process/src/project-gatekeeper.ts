import { DurableObject, RpcStub, RpcTarget } from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import type {
  ActionDescription,
  ActionKind,
  ApprovalQueue,
  Gatekeeper,
  GatekeeperUiFrame,
  GatekeeperUserVerifier,
  GitCache,
  ResourceDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import { computeCoverage } from "./coverage.js";
import { domainName } from "./domain.js";
import { applyGraphOps, diffGraphs, GraphOpError } from "./graph-ops.js";
import type { ProcessVerifierApi } from "./process.js";
import { MAX_RATIONALE_LENGTH, MAX_SUMMARY_LENGTH, type ProcessProjectDO } from "./project-do.js";
import type {
  ChangeReceipt, ChangeSet, GraphOp, ProcessGraph, ProcessNodeType, ProcessProject, ProjectContext, StepDuration,
} from "./types.js";
import type {
  ApplyResult,
  OpBatch,
  PendingPreview,
  ProjectHandle,
  ProjectSnapshot,
  ProjectSubscriberTarget,
} from "./ui-types.js";
import TYPES_CODE from "./types.txt";

/** Props minted by `ProcessAccount.getGatekeeperClassFor()`; they are the binding's authority. */
export type ProcessProjectProps = {
  sharingDomain: string;
  projectId: string;
  creatorAccountId: string;
  /** Present for `process://new` bindings, which create the project on first use. */
  newProjectName?: string;
};

type ProjectStub = DurableObjectStub<ProcessProjectDO>;

/** An agent change waiting for the person's decision, kept under its action ID. */
type Proposal = { actionId: number; decisionId: string; change: ChangeSet };

const PROJECT_UI_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Process map</title></head>
<body><p>Open this process from BA Projects in the Workshop.</p></body></html>`;

/** A person's direct-edit capability for the bound project, reached through `startUi()`. */
@validateRpc()
class ProjectHandleImpl extends RpcTarget implements ProjectHandle {
  constructor(private readonly project: ProjectStub, private readonly proposals: () => Proposal[]) {
    super();
  }

  snapshot(): Promise<ProjectSnapshot> {
    return this.project.snapshot();
  }

  applyOps(batch: OpBatch): Promise<ApplyResult> {
    return this.project.applyOps(batch, "user");
  }

  @skipRpcValidation()
  async subscribe(subscriber: RpcStub<ProjectSubscriberTarget>, fromRevision: number): Promise<Disposable> {
    return await this.project.subscribe(subscriber, fromRevision);
  }

  layout(): Promise<ApplyResult> {
    return this.project.layout();
  }

  async previewPending(): Promise<PendingPreview> {
    return previewOf((await this.project.snapshot()).graph, this.proposals());
  }
}

/** The agent's session: it reads freely (each read is an observation) and proposes every change. */
@validateRpc()
class ProcessProjectSession extends RpcTarget implements ProcessProject {
  constructor(
    private readonly project: ProjectStub,
    private readonly queue: RpcStub<ApprovalQueue>,
    private readonly projectId: string,
    private readonly proposals: () => Proposal[],
    private readonly propose: (
      queue: RpcStub<ApprovalQueue>, change: ChangeSet, description: ActionDescription,
    ) => Promise<Proposal>,
  ) {
    super();
  }

  async getContext(): Promise<ProjectContext> {
    await this.queue.authorizeObservation({
      title: "Read the process map",
      description: `Read the map, decisions and coverage of process project \`${this.projectId}\`.`,
    });
    const snapshot = await this.project.snapshot();
    const { graph } = simulate(snapshot.graph, this.proposals());
    return { name: snapshot.name, graph, decisions: snapshot.decisions, coverage: computeCoverage(graph) };
  }

  async applyChanges(input: ChangeSet): Promise<ChangeReceipt> {
    const change: ChangeSet = {
      summary: requireText(input.summary, "summary", MAX_SUMMARY_LENGTH),
      rationale: requireText(input.rationale, "rationale", MAX_RATIONALE_LENGTH),
      ops: input.ops,
    };
    if (change.ops.length === 0) throw new Error("A change needs at least one edit.");
    // Validate against the map as it will be once the earlier proposals are decided.
    const before = simulate((await this.project.snapshot()).graph, this.proposals()).graph;
    let after: ProcessGraph;
    try {
      after = applyGraphOps(before, change.ops);
    } catch (error) {
      if (error instanceof GraphOpError) throw new Error(error.message, { cause: error });
      throw error;
    }
    const { decisionId } = await this.propose(this.queue, change, {
      title: `Process map: ${change.summary}`,
      description: "Your analyst proposes this change to the process map, and shows it there until you decide.",
      // Together these show every value the change writes: each edit in full, and the decision
      // it records.
      fields: [
        { label: "Edits", kind: "list", items: change.ops.map((op) => describeEdit(op, before, after)) },
        { label: "Decision it records", kind: "text", value: `${change.summary}\n\n${change.rationale}` },
      ],
      descriptionIsComplete: true,
      implementsRevert: false,
      // The conversation waits for the person to accept or reject the change before going on.
      awaitDecision: true,
    });
    return { decisionId, graph: after };
  }
}

/**
 * The per-binding facet for one process project. A project is claimed by the workspace whose
 * binding first uses it, so it belongs to exactly one workspace, and that workspace's sharing
 * decides who reaches it.
 */
@validateRpc()
export class ProcessProjectGatekeeper extends DurableObject<Cloudflare.Env, ProcessProjectProps>
  implements Gatekeeper<ProcessProject>
{
  #claimed?: Promise<void>;
  #ready = false;

  async describe(): Promise<ResourceDescription> {
    const { name } = await (await this.#project()).snapshot();
    return {
      url: `process://project/${this.ctx.props.projectId}`,
      title: name,
      snippet: "A process map drawn live from the conversation.",
      suggestedBindingName: "PROCESS_PROJECT",
      tsType: "ProcessProject",
    };
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }

  /** Every map change is reviewed by the person; none is eligible for auto-approval. */
  async getAutoApprovableActions(): Promise<ActionKind[]> {
    return [];
  }

  async startSession(approvalQueue: RpcStub<ApprovalQueue>): Promise<ProcessProject> {
    const project = await this.#project();
    // The session keeps its own duplicate: `approvalQueue` is disposed when this call returns.
    return new ProcessProjectSession(
      project, approvalQueue.dup(), this.ctx.props.projectId,
      () => this.#proposals(), (queue, change, description) => this.#propose(queue, change, description),
    );
  }

  async startUi(): Promise<GatekeeperUiFrame> {
    const project = await this.#project();
    return { iframeHtml: PROJECT_UI_HTML, ui: new RpcStub(new ProjectHandleImpl(project, () => this.#proposals())) };
  }

  /** Collaborators must come from this deployment; workspace sharing decides the rest. */
  async addObserver(_id: string, user: Fetcher<GatekeeperUserVerifier>): Promise<void> {
    const verifier = user as unknown as Fetcher<ProcessVerifierApi>;
    if ((await verifier.getSharingDomain()) !== this.ctx.props.sharingDomain) {
      throw new Error("This collaborator's Process Studio account belongs to another deployment.");
    }
  }

  async removeObserver(_id: string): Promise<void> {}

  async applyAction(action: number, _cache: RpcStub<GitCache>): Promise<void> {
    const proposal = this.#proposals().find((p) => p.actionId === action);
    if (!proposal) throw new Error(`Unknown process map change ${action}.`);
    await (await this.#project()).applyAgentChange({ ...proposal.change, decisionId: proposal.decisionId });
    this.#sql().exec("DELETE FROM proposals WHERE action_id = ?", action);
  }

  async rejectAction(action: number): Promise<void> {
    this.#sql().exec("DELETE FROM proposals WHERE action_id = ?", action);
  }

  async revertAction(_action: number): Promise<void> {
    throw new Error("Accepted map changes are undone by proposing a new change.");
  }

  #sql(): SqlStorage {
    const sql = this.ctx.storage.sql;
    if (!this.#ready) {
      sql.exec(`CREATE TABLE IF NOT EXISTS proposals (
        action_id INTEGER PRIMARY KEY, decision_id TEXT NOT NULL, change TEXT NOT NULL)`);
      this.#ready = true;
    }
    return sql;
  }

  #proposals(): Proposal[] {
    return this.#sql().exec<{ action_id: number; decision_id: string; change: string }>(
      "SELECT * FROM proposals ORDER BY action_id",
    ).toArray().map((row) => ({
      actionId: row.action_id, decisionId: row.decision_id, change: JSON.parse(row.change) as ChangeSet,
    }));
  }

  // Action IDs are never reused, even after a rejection, because the Overseer keys its log by them.
  async #propose(queue: RpcStub<ApprovalQueue>, change: ChangeSet, description: ActionDescription): Promise<Proposal> {
    const actionId = this.ctx.storage.kv.get<number>("nextActionId") ?? 1;
    this.ctx.storage.kv.put("nextActionId", actionId + 1);
    const proposal: Proposal = { actionId, decisionId: crypto.randomUUID(), change };
    this.#sql().exec(
      "INSERT INTO proposals (action_id, decision_id, change) VALUES (?, ?, ?)",
      actionId, proposal.decisionId, JSON.stringify(change),
    );
    try {
      await queue.submitAction(actionId, description);
    } catch (error) {
      this.#sql().exec("DELETE FROM proposals WHERE action_id = ?", actionId);
      throw error;
    }
    return proposal;
  }

  // A facet inherits its parent Overseer's ID, which identifies the workspace that claims the project.
  async #project(): Promise<ProjectStub> {
    const { sharingDomain, projectId, creatorAccountId, newProjectName } = this.ctx.props;
    const project = this.ctx.exports.ProcessProjectDO.getByName(domainName(sharingDomain, projectId));
    this.#claimed ??= project.claim(
      this.ctx.id.toString(),
      newProjectName === undefined ? undefined : { projectId, name: newProjectName, creatorAccountId, sharingDomain },
    ).catch((error: unknown) => {
      this.#claimed = undefined;
      throw error;
    });
    await this.#claimed;
    return project;
  }
}

/** The map with pending proposals applied in order; proposals that no longer apply are reported. */
function simulate(graph: ProcessGraph, proposals: Proposal[]): { graph: ProcessGraph; conflicts: string[] } {
  let current = graph;
  const conflicts: string[] = [];
  for (const { change } of proposals) {
    try {
      current = applyGraphOps(current, change.ops);
    } catch (error) {
      conflicts.push(`"${change.summary}" no longer applies: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { graph: current, conflicts };
}

function previewOf(graph: ProcessGraph, proposals: Proposal[]): PendingPreview {
  const { graph: after, conflicts } = simulate(graph, proposals);
  const diff = diffGraphs(graph, after);
  const laneIds = new Set(graph.lanes.map((lane) => lane.id));
  return {
    addedLanes: after.lanes.filter((lane) => !laneIds.has(lane.id)),
    addedNodes: after.nodes.filter((node) => diff.addedNodeIds.includes(node.id)),
    addedEdges: after.edges.filter((edge) => diff.addedEdgeIds.includes(edge.id)),
    removedNodeIds: diff.removedNodeIds,
    removedEdgeIds: diff.removedEdgeIds,
    changedNodeIds: diff.changedNodeIds,
    changedEdgeIds: diff.changedEdgeIds,
    ...(conflicts.length ? { conflicts } : {}),
  };
}

// One readable line per edit for the approval card, naming steps and lanes rather than IDs.
const NODE_KINDS: Record<ProcessNodeType, string> = {
  startEvent: "start", endEvent: "end", timerEvent: "wait", userTask: "step", serviceTask: "automated step",
  manualTask: "manual step", exclusiveGateway: "decision", parallelGateway: "parallel split",
};

/** An element by its label and ID, looked up in the map after the change, then before it. */
function named<T extends { id: string; label?: string }>(after: T[], before: T[], id: string): string {
  const found = after.find((x) => x.id === id)?.label ?? before.find((x) => x.id === id)?.label;
  return found === undefined ? `[${id}]` : `“${found}” [${id}]`;
}

function at(x?: number, y?: number): string {
  return x === undefined || y === undefined ? "" : ` at (${x}, ${y})`;
}

/**
 * One edit as a plain sentence for the approval card, carrying every value it writes (IDs in
 * brackets) so the card stays a complete record of the change without showing its JSON.
 */
function describeEdit(op: GraphOp, before: ProcessGraph, after: ProcessGraph): string {
  const step = (id: string) => named(after.nodes, before.nodes, id);
  const lane = (id: string) => named(after.lanes, before.lanes, id);
  switch (op.op) {
    case "addLane": return `Add lane “${op.lane.label}” [${op.lane.id}]`;
    case "renameLane": return `Rename lane ${lane(op.id)} to “${op.label}”`;
    case "deleteLane": return `Remove lane ${lane(op.id)}`;
    case "addNode": {
      const { id, type, label: name, laneId, x, y } = op.node;
      return `Add ${NODE_KINDS[type]} “${name}” [${id}] to ${lane(laneId)}${at(x, y)}${stepDetails(op.node)}`;
    }
    case "updateNode": {
      const changes = [
        op.label === undefined ? "" : `rename to “${op.label}”`,
        op.type === undefined ? "" : `make it a ${NODE_KINDS[op.type]}`,
        op.laneId === undefined ? "" : `move to ${lane(op.laneId)}`,
      ].filter(Boolean).join(", ");
      return `Update ${step(op.id)}${changes ? `: ${changes}` : ""}${stepDetails(op)}`;
    }
    case "moveNode": return `Move ${step(op.id)}${at(op.x, op.y)}`;
    case "deleteNode": return `Remove ${step(op.id)} and its flows`;
    case "addEdge": return `Connect ${step(op.edge.source)} → ${step(op.edge.target)} [${op.edge.id}]` +
      (op.edge.label ? ` labelled “${op.edge.label}”` : "");
    case "updateEdge": return `Relabel flow [${op.id}] “${op.label ?? ""}”`;
    case "deleteEdge": return `Remove flow [${op.id}]`;
  }
}

/** The step details an edit can set; `null` clears one. */
type StepDetails = Omit<Extract<GraphOp, { op: "updateNode" }>, "op" | "id" | "label" | "type" | "laneId">;

function stepDetails(details: StepDetails): string {
  const parts: string[] = [];
  const add = (name: string, value: string | string[] | StepDuration | null | undefined) => {
    if (value === undefined) return;
    if (value === null) parts.push(`${name} cleared`);
    else if (Array.isArray(value)) parts.push(`${name}: ${value.map((item) => `“${item}”`).join(", ")}`);
    else if (typeof value === "object") parts.push(`${name}: ${value.amount} ${value.unit}`);
    else parts.push(`${name}: “${value}”`);
  };
  add("owner", details.owner);
  add("system", details.system);
  add("inputs", details.inputs);
  add("outputs", details.outputs);
  add("duration", details.duration);
  add("pain points", details.painPoints);
  add("description", details.description);
  return parts.length ? ` — ${parts.join("; ")}` : "";
}

function requireText(value: string, what: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`The change needs a ${what}.`);
  if (value.trim().length > max) throw new Error(`The ${what} must be at most ${max} characters.`);
  return value.trim();
}
