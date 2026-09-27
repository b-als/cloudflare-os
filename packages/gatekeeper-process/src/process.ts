import { RpcStub, RpcTarget, WorkerEntrypoint } from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import type {
  AccountDescription,
  AppUiContext,
  GatekeeperConnectCallback,
  GatekeeperConnectOptions,
  GatekeeperUiFrame,
  GatekeeperUser,
  GatekeeperUserVerifier,
  ResourceConfiguratorFrame,
  SupportedResource,
  VendorDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import { DEFAULT_SHARING_DOMAIN, domainName } from "./domain.js";
import type { AccountProjectsDO } from "./account-projects-do.js";
import type { DecisionInput, ProcessProjectDO } from "./project-do.js";
import type { Decision, ProjectSummary } from "./types.js";
import type {
  ApplyResult,
  OpBatch,
  ProcessStudioApi,
  ProjectHandle,
  ProjectRole,
  ProjectSnapshot,
  ProjectSubscriber,
} from "./ui-types.js";
import TYPES_CODE from "./types.txt";

export const VENDOR_ID = "process";

const PROCESS_ICON = {
  url:
    "data:image/svg+xml," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256' fill='currentColor'>" +
        "<path d='M216 40H40a16 16 0 0 0-16 16v144a16 16 0 0 0 16 16h176a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16Zm0 56H40V56h176Zm0 104H40v-88h176Z'/></svg>",
    ),
};

const APP_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Process Studio</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem;color:#333}</style></head>
<body><h1>Process Studio</h1><p>Open your process projects from the Workshop at
<a href="/ba-projects" target="_blank" rel="noopener">/ba-projects</a>.</p></body></html>`;

const PROJECT_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

type ProjectNamespace = DurableObjectNamespace<ProcessProjectDO>;
type IndexNamespace = DurableObjectNamespace<AccountProjectsDO>;

/** Scope bound into an account's UI capability. */
export type ProcessStudioScope = {
  sharingDomain: string;
  accountId: string;
  projects: ProjectNamespace;
  indexes: IndexNamespace;
};

/** Capability for one project, minted only after membership is verified. */
@validateRpc()
export class ProjectHandleImpl extends RpcTarget implements ProjectHandle {
  readonly #project: DurableObjectStub<ProcessProjectDO>;
  readonly #accountId: string;

  constructor(project: DurableObjectStub<ProcessProjectDO>, accountId: string) {
    super();
    this.#project = project;
    this.#accountId = accountId;
  }

  snapshot(): Promise<ProjectSnapshot> {
    return this.#project.snapshot(this.#accountId);
  }

  applyOps(batch: OpBatch): Promise<ApplyResult> {
    return this.#project.applyOps(this.#accountId, batch);
  }

  @skipRpcValidation()
  async subscribe(_subscriber: ProjectSubscriber, _fromRevision: number): Promise<Disposable> {
    throw new Error("Live project updates are not implemented yet.");
  }

  recordDecision(decision: DecisionInput): Promise<Decision> {
    return this.#project.recordDecision(this.#accountId, decision);
  }

  resolveQuestion(questionId: string, answer: string): Promise<void> {
    return this.#project.resolveQuestion(this.#accountId, questionId, answer);
  }

  async createInvite(_role: Exclude<ProjectRole, "owner">): Promise<{ inviteKey: string }> {
    throw new Error("Project invites are not implemented yet.");
  }
}

/** Process Studio management capability for one account. */
@validateRpc()
export class ProcessStudioApiImpl extends RpcTarget implements ProcessStudioApi {
  readonly #scope: ProcessStudioScope;

  constructor(scope: ProcessStudioScope) {
    super();
    this.#scope = scope;
  }

  listProjects(): Promise<ProjectSummary[]> {
    return this.#index().list();
  }

  async createProject(name: string): Promise<ProjectSummary> {
    const projectId = crypto.randomUUID();
    const summary = await this.#project(projectId).init(
      projectId, name, this.#scope.accountId, this.#scope.sharingDomain,
    );
    await this.#index().upsert(summary);
    return summary;
  }

  async openProject(projectId: string): Promise<ProjectHandle> {
    if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error("Invalid project ID.");
    const project = this.#project(projectId);
    const role = await project.memberRole(this.#scope.accountId);
    if (!role) throw new Error("Project not found or you do not have access.");
    return new ProjectHandleImpl(project, this.#scope.accountId);
  }

  async joinProject(_inviteKey: string): Promise<ProjectSummary> {
    throw new Error("Project invites are not implemented yet.");
  }

  #project(projectId: string): DurableObjectStub<ProcessProjectDO> {
    return this.#scope.projects.getByName(domainName(this.#scope.sharingDomain, projectId));
  }

  #index(): DurableObjectStub<AccountProjectsDO> {
    return this.#scope.indexes.getByName(
      domainName(this.#scope.sharingDomain, this.#scope.accountId),
    );
  }
}

type ProcessAccountProps = { sharingDomain: string; accountId: string };

/** An auto-provisioned Process Studio account; its authority is the account capability itself. */
@validateRpc()
export class ProcessAccount
  extends WorkerEntrypoint<Cloudflare.Env, ProcessAccountProps>
  implements GatekeeperUser
{
  async describe(): Promise<AccountDescription> {
    return {
      displayName: "Process Studio",
      avatar: PROCESS_ICON,
      providesUi: { title: "Process Studio", icon: PROCESS_ICON },
    };
  }

  async startAppUi(_context: AppUiContext): Promise<GatekeeperUiFrame> {
    const ui = new RpcStub(new ProcessStudioApiImpl(this.#scope()));
    return { iframeHtml: APP_HTML, ui };
  }

  async getSupportedResources(): Promise<SupportedResource[]> {
    return [];
  }

  getGatekeeperClassFor(_url: string): never {
    throw new Error("Process Studio has no URL-addressed resources.");
  }

  startResourceConfigurator(_resourceUrlPattern: string): Promise<ResourceConfiguratorFrame> {
    throw new Error("Process Studio has no URL-addressed resources.");
  }

  async ensureResources(_resourceUrlPatterns: string[]): Promise<{ url?: string }> {
    return {};
  }

  /** Leaves every indexed project (deleting ones left memberless) and clears the index. */
  async revoke(): Promise<void> {
    const scope = this.#scope();
    const index = scope.indexes.getByName(domainName(scope.sharingDomain, scope.accountId));
    const projects = await index.list();
    await Promise.all(projects.map(({ projectId }) =>
      scope.projects.getByName(domainName(scope.sharingDomain, projectId))
        .removeMember(scope.accountId)
    ));
    await index.clear();
  }

  reconnect(): Promise<{ url: string }> {
    throw new Error("Process Studio has no connect flow.");
  }

  async getAuthenticatedEmail(): Promise<string | null> {
    return null;
  }

  // No gadget-bound resources exist yet, so the verifier is never consulted.
  @skipRpcValidation()
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.ctx.exports.ProcessVerifier({});
  }

  #scope(): ProcessStudioScope {
    return {
      sharingDomain: this.ctx.props.sharingDomain,
      accountId: this.ctx.props.accountId,
      projects: this.ctx.exports.ProcessProjectDO,
      indexes: this.ctx.exports.AccountProjectsDO,
    };
  }
}

@validateRpc()
export class ProcessVerifier
  extends WorkerEntrypoint<Cloudflare.Env>
  implements GatekeeperUserVerifier
{
  verify(): void {}
}

type GatekeeperVendorProps = { sharingDomain?: string };

@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<Cloudflare.Env, GatekeeperVendorProps> {
  async describe(): Promise<VendorDescription> {
    return {
      displayName: "Process Studio",
      url: "https://workers.cloudflare.com/",
      logo: PROCESS_ICON,
      tagline: "Map business processes with your team",
      description:
        "Collaboratively map a business process as a swimlane diagram and keep a log of the " +
        "decisions behind it.",
      autoProvisionsAccount: true,
      providesAuth: false,
    };
  }

  // Skip return validation: proxy-wrapping a WorkerEntrypoint stub breaks Workers serialization.
  @skipRpcValidation()
  async createAccount(): Promise<Fetcher<GatekeeperUser>> {
    const sharingDomain = this.ctx.props.sharingDomain ?? DEFAULT_SHARING_DOMAIN;
    return this.ctx.exports.ProcessAccount({
      props: { sharingDomain, accountId: crypto.randomUUID() },
    }) as unknown as Fetcher<GatekeeperUser>;
  }

  connectAccount(
    _callback: Fetcher<GatekeeperConnectCallback>,
    _options?: GatekeeperConnectOptions,
  ): Promise<{ url: string }> {
    throw new Error("Process Studio is auto-provisioned and has no connect flow.");
  }

  async getSupportedResources(_options?: { userId?: string }): Promise<SupportedResource[]> {
    return [];
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }
}
