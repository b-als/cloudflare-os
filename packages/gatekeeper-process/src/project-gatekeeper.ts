import { DurableObject, RpcStub, RpcTarget } from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import type {
  ActionDescription,
  ActionKind,
  ApprovalQueue,
  Gatekeeper,
  GatekeeperUiFrame,
  GatekeeperUserVerifier,
  ResourceDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import { domainName } from "./domain.js";
import { computeCoverage } from "./coverage.js";
import { applyGraphOps, diffGraphs, touchedElementIds } from "./graph-ops.js";
import { applyLifecycleOps, emptyLifecycle, validateBaseline } from "./lifecycle.js";
import type { ProcessVerifierApi } from "./process.js";
import type { DecisionInput, ProcessProjectDO } from "./project-do.js";
import type {
  ChangeReceipt,
  BaLifecycle,
  ChangeSet,
  Decision,
  GraphOp,
  OpenQuestion,
  ProcessGraph,
  ProcessModel,
  ProcessProject,
  ProjectContext,
} from "./types.js";
import type {
  ApplyResult,
  OpBatch,
  PendingPreview,
  ProjectHandle,
  ProjectSnapshot,
  ProjectSubscriber,
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

const PROJECT_UI_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Process project</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem;color:#333}</style></head>
<body><p>Open this process project from Process Studio in the Workshop.</p></body></html>`;

type ProjectStub = DurableObjectStub<ProcessProjectDO>;

/** A build-role user's direct-edit capability for the bound project. */
@validateRpc()
class ProjectHandleImpl extends RpcTarget implements ProjectHandle {
  readonly #project: ProjectStub;
  readonly #pending: () => Array<{ actionId: number; pending: Pending }>;

  constructor(project: ProjectStub, pending: () => Array<{ actionId: number; pending: Pending }>) {
    super();
    this.#project = project;
    this.#pending = pending;
  }

  snapshot(): Promise<ProjectSnapshot> {
    return this.#project.snapshot();
  }

  applyLifecycle(batch: Parameters<ProjectHandle["applyLifecycle"]>[0]): Promise<ProjectSnapshot> {
    return this.#project.applyLifecycle(batch);
  }

  createBaseline(baseRevision: number): ReturnType<ProjectHandle["createBaseline"]> {
    return this.#project.createBaseline(baseRevision);
  }

  applyOps(batch: OpBatch): Promise<ApplyResult> {
    return this.#project.applyOps(batch, "user");
  }

  @skipRpcValidation()
  async subscribe(
    subscriber: RpcStub<ProjectSubscriber & RpcTarget>,
    fromRevision: number,
  ): Promise<Disposable> {
    return await this.#project.subscribe(subscriber, fromRevision);
  }

  recordDecision(decision: DecisionInput): Promise<Decision> {
    return this.#project.recordDecision(decision, "user");
  }

  resolveQuestion(questionId: string, answer: string): Promise<void> {
    return this.#project.resolveQuestion(questionId, answer, "user");
  }

  layout(): Promise<ApplyResult> {
    return this.#project.layout();
  }

  async previewPending(model: ProcessModel = "asIs"): Promise<PendingPreview> {
    const snapshot = await this.#project.snapshot();
    return buildPendingPreview(snapshot, this.#pending().map((p) => p.pending), model);
  }
}

// A question only adds an open question for stakeholders; it never touches the graph, so it is
// eligible for a user's own auto-approval rules unlike `applyChanges`, which always needs review.
const RAISE_QUESTION_ACTION_KIND: ActionKind = { tag: "process.raiseQuestion", label: "Record a process question" };

/** An agent proposal awaiting the user's decision, stored in the facet under its action ID. */
type Pending =
  | { kind: "change"; decisionId: string; change: ChangeSet }
  | { kind: "question"; questionId: string; text: string; nodeIds: string[] };

/** Project state as the agent sees it: committed state with pending proposals applied in order. */
type Simulated = { graph: ProcessGraph; lifecycle: BaLifecycle; decisions: Decision[]; openQuestions: OpenQuestion[] };

function lockedIds(decisions: Decision[], except: ReadonlySet<string>, model: ProcessModel = "asIs") {
  const locked = decisions.filter((d) => (d.model ?? "asIs") === model && d.status === "active" && d.locked && !except.has(d.decisionId));
  return {
    lockedNodeIds: locked.flatMap((d) => d.nodeIds),
    lockedEdgeIds: locked.flatMap((d) => d.edgeIds),
  };
}

// Applies every pending proposal in order (skipping ones a stakeholder edit has overtaken) and
// diffs the result against the committed graph, for a canvas preview.
function buildPendingPreview(snapshot: ProjectSnapshot, pendingList: Pending[], model: ProcessModel): PendingPreview {
  let state: Simulated = {
    graph: snapshot.graph, lifecycle: snapshot.lifecycle ?? emptyLifecycle(snapshot.graph.revision),
    decisions: snapshot.decisions.filter((d) => d.status === "active"), openQuestions: [],
  };
  const graph = model === "toBe" ? state.lifecycle.toBe : state.graph;
  const proposedQuestions: OpenQuestion[] = [];
  const conflicts: string[] = [];
  for (const pending of pendingList) {
    try {
      if (pending.kind === "change") {
        state = { ...state, ...simulateChange(state, pending.decisionId, pending.change) };
      } else {
        proposedQuestions.push({
          questionId: pending.questionId, text: pending.text, nodeIds: pending.nodeIds, raisedAt: Date.now(),
        });
      }
    } catch (error) {
      conflicts.push(error instanceof Error ? error.message : String(error));
    }
  }
  const resultGraph = model === "toBe" ? state.lifecycle.toBe : state.graph;
  const diff = diffGraphs(graph, resultGraph);
  return {
    addedNodes: resultGraph.nodes.filter((n) => diff.addedNodeIds.includes(n.id)),
    addedEdges: resultGraph.edges.filter((e) => diff.addedEdgeIds.includes(e.id)),
    removedNodeIds: diff.removedNodeIds,
    removedEdgeIds: diff.removedEdgeIds,
    changedNodeIds: diff.changedNodeIds,
    changedEdgeIds: diff.changedEdgeIds,
    proposedQuestions,
    ...(conflicts.length ? { conflicts } : {}),
  };
}

// Applies one pending change to `state`, returning the graph and the decision it would record.
function simulateChange(state: Simulated, decisionId: string, change: ChangeSet) {
  const supersedes = new Set(change.supersedes ?? []);
  for (const id of supersedes) {
    if (!state.decisions.some((d) => d.decisionId === id && d.status === "active")) {
      throw new Error(`Decision "${id}" is not an active decision.`);
    }
  }
  const targetModel = change.model === "toBe";
  const before = targetModel ? state.lifecycle.toBe : state.graph;
  const locks = lockedIds(state.decisions, supersedes, change.model);
  const graph = applyGraphOps(before, change.ops, locks);
  const touched = touchedElementIds(change.ops, before);
  const lifecycle = change.lifecycleOps?.length || targetModel
    ? applyLifecycleOps(state.lifecycle, change.lifecycleOps ?? [], targetModel ? change.ops : [], locks)
    : state.lifecycle;
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const edgeIds = new Set(graph.edges.map((e) => e.id));
  const decision: Decision = {
    decisionId,
    summary: change.summary,
    rationale: change.rationale,
    nodeIds: touched.nodeIds.filter((id) => nodeIds.has(id)),
    edgeIds: touched.edgeIds.filter((id) => edgeIds.has(id)),
    locked: false,
    status: "active",
    decidedAt: Date.now(),
  };
  if (targetModel) decision.model = "toBe";
  return {
    graph: targetModel ? state.graph : graph,
    lifecycle,
    decisions: [decision, ...state.decisions.filter((d) => !supersedes.has(d.decisionId))],
  };
}

function describeOp(op: GraphOp, before: ProcessGraph, after: ProcessGraph): string {
  const find = <T extends { id: string; label?: string }>(a: T[], b: T[], id: string) =>
    a.find((x) => x.id === id)?.label ?? b.find((x) => x.id === id)?.label ?? id;
  const label = (id: string) => find(after.nodes, before.nodes, id);
  const lane = (id: string) => find(after.lanes, before.lanes, id);
  switch (op.op) {
    case "addLane": return `Add lane **${op.lane.label}**`;
    case "renameLane": return `Rename lane **${lane(op.id)}** to **${op.label}**`;
    case "deleteLane": return `Remove lane **${lane(op.id)}**`;
    case "addNode": return `Add ${op.node.type} **${op.node.label}** in lane **${lane(op.node.laneId)}**`;
    case "updateNode": return `Update **${label(op.id)}**` +
      [op.label && ` label to "${op.label}"`, op.type && ` type to ${op.type}`,
        op.laneId && ` lane to ${lane(op.laneId)}`].filter(Boolean).join(",");
    case "moveNode": return `Move **${label(op.id)}**`;
    case "deleteNode": return `Remove **${label(op.id)}** and its connections`;
    case "addEdge": return `Connect **${label(op.edge.source)}** → **${label(op.edge.target)}**` +
      (op.edge.label ? ` ("${op.edge.label}")` : "");
    case "updateEdge": return `Relabel connection \`${op.id}\` to "${op.label ?? ""}"`;
    case "deleteEdge": return `Remove connection \`${op.id}\``;
  }
}

/** The agent/gadget session for the bound project; reads are observations, writes are proposals. */
@validateRpc()
class ProcessProjectSessionImpl extends RpcTarget implements ProcessProject {
  readonly #project: ProjectStub;
  readonly #approvalQueue: RpcStub<ApprovalQueue>;
  readonly #projectId: string;
  readonly #proposals: ProposalStore;

  constructor(
    project: ProjectStub,
    approvalQueue: RpcStub<ApprovalQueue>,
    projectId: string,
    proposals: ProposalStore,
  ) {
    super();
    this.#project = project;
    this.#approvalQueue = approvalQueue;
    this.#projectId = projectId;
    this.#proposals = proposals;
  }

  async #simulated(): Promise<Simulated & { name: string; changeWarnings: string[] }> {
    const snapshot = await this.#project.snapshot();
    let state: Simulated = {
      graph: snapshot.graph,
      lifecycle: snapshot.lifecycle ?? emptyLifecycle(snapshot.graph.revision),
      decisions: snapshot.decisions.filter((d) => d.status === "active"),
      openQuestions: snapshot.openQuestions,
    };
    const changeWarnings: string[] = [];
    for (const { pending } of this.#proposals.list()) {
      try {
        if (pending.kind === "change") {
          state = { ...state, ...simulateChange(state, pending.decisionId, pending.change) };
        } else {
          state = { ...state, openQuestions: [...state.openQuestions, {
            questionId: pending.questionId, text: pending.text, nodeIds: pending.nodeIds, raisedAt: Date.now(),
          }] };
        }
      } catch (error) {
        changeWarnings.push(error instanceof Error ? error.message : String(error));
      }
    }
    return { ...state, name: snapshot.name, changeWarnings };
  }

  async getContext(): Promise<ProjectContext> {
    await this.#approvalQueue.authorizeObservation({
      title: "Read process project context",
      description: `Read the graph, active decisions, and open questions of process project ` +
        `\`${this.#projectId}\`.`,
    });
    const { name, graph, lifecycle, decisions, openQuestions, changeWarnings } = await this.#simulated();
    return {
      projectId: this.#projectId, name, graph, lifecycle, decisions, openQuestions, coverage: computeCoverage(graph),
      validation: validateBaseline({
        projectId: this.#projectId, name, revision: lifecycle.contentRevision,
        asIs: graph, toBe: lifecycle.toBe, artifacts: lifecycle.artifacts, decisions, openQuestions,
      }),
      ...(changeWarnings.length ? { changeWarnings } : {}),
    };
  }

  async getGraph(model: ProcessModel = "asIs"): Promise<ProcessGraph> {
    await this.#approvalQueue.authorizeObservation({
      title: "Read process graph",
      description: `Read the graph of process project \`${this.#projectId}\`.`,
    });
    const state = await this.#simulated();
    return model === "toBe" ? state.lifecycle.toBe : state.graph;
  }

  async applyChanges(change: ChangeSet): Promise<ChangeReceipt> {
    const summary = requireText(change.summary, "summary");
    const rationale = requireText(change.rationale, "rationale");
    if (!Array.isArray(change.ops) || (change.ops.length === 0 && !change.lifecycleOps?.length)) {
      throw new Error("A change set must contain at least one op.");
    }
    const clean: ChangeSet = {
      summary, rationale, ops: change.ops, supersedes: change.supersedes ?? [],
      model: change.model ?? "asIs", lifecycleOps: change.lifecycleOps ?? [],
    };
    const state = await this.#simulated();
    const decisionId = crypto.randomUUID();
    const simulated = simulateChange(state, decisionId, clean);
    const graph = clean.model === "toBe" ? simulated.lifecycle.toBe : simulated.graph;
    const before = clean.model === "toBe" ? state.lifecycle.toBe : state.graph;
    const ops = [
      ...clean.ops.map((op) => `- ${describeOp(op, before, graph)}`),
      ...(clean.lifecycleOps ?? []).map((op) => op.op === "putArtifact"
        ? `- Save ${op.artifact.kind}: **${op.artifact.title}** (\`${op.artifact.id}\`)\n\n\`\`\`json\n${JSON.stringify(op.artifact, null, 2)}\n\`\`\``
        : `- Remove artifact \`${op.id}\``),
    ];
    const superseded = state.decisions.filter((d) => clean.supersedes?.includes(d.decisionId));
    await this.#proposals.submit(this.#approvalQueue, { kind: "change", decisionId, change: clean }, {
      title: `Process map: ${summary}`,
      description: [
        `**${summary}**`, "", rationale, "", "Changes:", ...ops,
        ...(superseded.length ? ["", "Replaces decisions:", ...superseded.map((d) => `- ${d.summary}`)] : []),
      ].join("\n"),
      implementsRevert: false,
    });
    return { decisionId, graph };
  }

  async raiseQuestion(question: { text: string; nodeIds?: string[] }): Promise<{ questionId: string }> {
    const text = requireText(question.text, "question");
    const nodeIds = [...new Set(question.nodeIds ?? [])];
    const { graph } = await this.#simulated();
    for (const id of nodeIds) {
      if (!graph.nodes.some((n) => n.id === id)) throw new Error(`Node "${id}" does not exist.`);
    }
    const questionId = crypto.randomUUID();
    await this.#proposals.submit(this.#approvalQueue, { kind: "question", questionId, text, nodeIds }, {
      title: `Process question: ${text.slice(0, 80)}`,
      description: `Record an open question for stakeholders:\n\n> ${text}`,
      implementsRevert: false,
      actionKind: RAISE_QUESTION_ACTION_KIND,
      autoApprovable: true,
    });
    return { questionId };
  }
}

function requireText(value: unknown, what: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`The ${what} must not be empty.`);
  return text;
}

/** The facet's own record of pending proposals, keyed by approval-queue action ID. */
interface ProposalStore {
  list(): Array<{ actionId: number; pending: Pending }>;
  submit(queue: RpcStub<ApprovalQueue>, pending: Pending, description: ActionDescription): Promise<void>;
}

/**
 * The per-binding facet for one process project. The project is claimed by the workspace this
 * facet is inherited from, so a project can be linked to only one workspace, and workspace
 * sharing decides who reaches it.
 */
@validateRpc()
export class ProcessProjectGatekeeper extends DurableObject<Cloudflare.Env, ProcessProjectProps>
  implements Gatekeeper<ProcessProject>
{
  #claimed?: Promise<void>;

  async describe(): Promise<ResourceDescription> {
    const project = await this.#project();
    const { name } = await project.snapshot();
    return {
      url: `process://project/${this.ctx.props.projectId}`,
      title: name,
      snippet: "A swimlane process map with its decision log.",
      suggestedBindingName: "PROCESS_PROJECT",
      tsType: "ProcessProject",
    };
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }

  async getAutoApprovableActions(): Promise<ActionKind[]> {
    return [RAISE_QUESTION_ACTION_KIND];
  }

  async startSession(approvalQueue: RpcStub<ApprovalQueue>): Promise<ProcessProject> {
    const project = await this.#project();
    return new ProcessProjectSessionImpl(project, approvalQueue.dup(), this.ctx.props.projectId, {
      list: () => this.#pendingList(),
      submit: (queue, pending, description) => this.#submit(queue, pending, description),
    });
  }

  async startUi(): Promise<GatekeeperUiFrame> {
    const project = await this.#project();
    return {
      iframeHtml: PROJECT_UI_HTML,
      ui: new RpcStub(new ProjectHandleImpl(project, () => this.#pendingList())),
    };
  }

  /** Check the deployment domain; workspace sharing controls access to this project. */
  async addObserver(_id: string, user: Fetcher<GatekeeperUserVerifier>): Promise<void> {
    const verifier = user as unknown as Fetcher<ProcessVerifierApi>;
    if ((await verifier.getSharingDomain()) !== this.ctx.props.sharingDomain) {
      throw new Error("This collaborator's Process Studio account belongs to another deployment.");
    }
  }

  async removeObserver(_id: string): Promise<void> {}

  async applyAction(action: number): Promise<void> {
    const pending = this.#pendingGet(action);
    if (!pending) throw new Error(`Unknown Process Studio action ${action}.`);
    const project = await this.#project();
    if (pending.kind === "change") {
      await project.applyAgentChange({ ...pending.change, decisionId: pending.decisionId });
    } else {
      await project.raiseQuestion({ text: pending.text, nodeIds: pending.nodeIds }, "agent", pending.questionId);
    }
    this.#pendingDelete(action);
  }

  async rejectAction(action: number): Promise<void> {
    this.#pendingDelete(action);
  }

  async revertAction(_action: number): Promise<void> {
    throw new Error("Process Studio changes cannot be reverted automatically yet.");
  }

  #sqlReady = false;
  #sql(): SqlStorage {
    const sql = this.ctx.storage.sql;
    if (!this.#sqlReady) {
      sql.exec("CREATE TABLE IF NOT EXISTS pending (action_id INTEGER PRIMARY KEY, payload TEXT NOT NULL)");
      this.#sqlReady = true;
    }
    return sql;
  }

  #pendingList(): Array<{ actionId: number; pending: Pending }> {
    return this.#sql().exec<{ action_id: number; payload: string }>(
      "SELECT action_id, payload FROM pending ORDER BY action_id",
    ).toArray().map((row) => ({ actionId: row.action_id, pending: JSON.parse(row.payload) as Pending }));
  }

  #pendingGet(action: number): Pending | undefined {
    const row = this.#sql().exec<{ payload: string }>(
      "SELECT payload FROM pending WHERE action_id = ?", action,
    ).toArray()[0];
    return row && (JSON.parse(row.payload) as Pending);
  }

  #pendingDelete(action: number): void {
    this.#sql().exec("DELETE FROM pending WHERE action_id = ?", action);
  }

  // Action IDs are never reused, even after a rejection, since the Overseer keys its log by them.
  async #submit(queue: RpcStub<ApprovalQueue>, pending: Pending, description: ActionDescription): Promise<void> {
    const actionId = (this.ctx.storage.kv.get<number>("nextActionId") ?? 1);
    this.ctx.storage.kv.put("nextActionId", actionId + 1);
    this.#sql().exec("INSERT INTO pending (action_id, payload) VALUES (?, ?)", actionId, JSON.stringify(pending));
    try {
      await queue.submitAction(actionId, description);
    } catch (error) {
      this.#pendingDelete(actionId);
      throw error;
    }
  }

  // A facet inherits its parent Overseer's ID, which identifies the workspace (see Scheduler).
  async #project(): Promise<ProjectStub> {
    const { sharingDomain, projectId, creatorAccountId, newProjectName } = this.ctx.props;
    const project = this.ctx.exports.ProcessProjectDO.getByName(domainName(sharingDomain, projectId));
    this.#claimed ??= project.claim(
      this.ctx.id.toString(),
      newProjectName === undefined
        ? undefined
        : { projectId, name: newProjectName, creatorAccountId, sharingDomain },
    ).catch((error: unknown) => {
      this.#claimed = undefined;
      throw error;
    });
    await this.#claimed;
    return project;
  }
}
