import { DurableObject, RpcStub, RpcTarget } from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import type {
  ActionKind,
  ApprovalQueue,
  Gatekeeper,
  GatekeeperUiFrame,
  GatekeeperUserVerifier,
  ResourceDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import { domainName } from "./domain.js";
import type { ProcessVerifierApi } from "./process.js";
import type { DecisionInput, ProcessProjectDO } from "./project-do.js";
import type {
  ChangeReceipt,
  ChangeSet,
  Decision,
  ProcessGraph,
  ProcessProject,
  ProjectContext,
} from "./types.js";
import type {
  ApplyResult,
  OpBatch,
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

  constructor(project: ProjectStub) {
    super();
    this.#project = project;
  }

  snapshot(): Promise<ProjectSnapshot> {
    return this.#project.snapshot();
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
}

/** The agent/gadget session for the bound project; every read is an authorized observation. */
@validateRpc()
class ProcessProjectSessionImpl extends RpcTarget implements ProcessProject {
  readonly #project: ProjectStub;
  readonly #approvalQueue: RpcStub<ApprovalQueue>;
  readonly #projectId: string;

  constructor(project: ProjectStub, approvalQueue: RpcStub<ApprovalQueue>, projectId: string) {
    super();
    this.#project = project;
    this.#approvalQueue = approvalQueue;
    this.#projectId = projectId;
  }

  async getContext(): Promise<ProjectContext> {
    await this.#approvalQueue.authorizeObservation({
      title: "Read process project context",
      description: `Read the graph, active decisions, and open questions of process project ` +
        `\`${this.#projectId}\`.`,
    });
    const snapshot = await this.#project.snapshot();
    return {
      projectId: snapshot.projectId,
      name: snapshot.name,
      graph: snapshot.graph,
      decisions: snapshot.decisions.filter((decision) => decision.status === "active"),
      openQuestions: snapshot.openQuestions,
    };
  }

  async getGraph(): Promise<ProcessGraph> {
    await this.#approvalQueue.authorizeObservation({
      title: "Read process graph",
      description: `Read the graph of process project \`${this.#projectId}\`.`,
    });
    return (await this.#project.snapshot()).graph;
  }

  async applyChanges(_change: ChangeSet): Promise<ChangeReceipt> {
    throw new Error("Not available yet");
  }

  async raiseQuestion(_question: { text: string; nodeIds?: string[] }): Promise<{ questionId: string }> {
    throw new Error("Not available yet");
  }
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
    return [];
  }

  async startSession(approvalQueue: RpcStub<ApprovalQueue>): Promise<ProcessProject> {
    const project = await this.#project();
    return new ProcessProjectSessionImpl(project, approvalQueue.dup(), this.ctx.props.projectId);
  }

  async startUi(): Promise<GatekeeperUiFrame> {
    const project = await this.#project();
    return { iframeHtml: PROJECT_UI_HTML, ui: new RpcStub(new ProjectHandleImpl(project)) };
  }

  // Low-stakes same-domain check: workspace sharing is the authority over who may see the project.
  async addObserver(_id: string, user: Fetcher<GatekeeperUserVerifier>): Promise<void> {
    const verifier = user as unknown as Fetcher<ProcessVerifierApi>;
    if ((await verifier.getSharingDomain()) !== this.ctx.props.sharingDomain) {
      throw new Error("This collaborator's Process Studio account belongs to another deployment.");
    }
  }

  async removeObserver(_id: string): Promise<void> {}

  async applyAction(_action: number): Promise<void> {
    throw new Error("Process Studio does not submit actions yet.");
  }

  async rejectAction(_action: number): Promise<void> {
    throw new Error("Process Studio does not submit actions yet.");
  }

  async revertAction(_action: number): Promise<void> {
    throw new Error("Process Studio does not submit actions yet.");
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
