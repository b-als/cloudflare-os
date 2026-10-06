import { RpcStub, RpcTarget, WorkerEntrypoint } from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import type {
  AccountDescription,
  AppUiContext,
  Gatekeeper,
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
import { MAX_PROJECT_NAME_LENGTH } from "./project-do.js";
import type { ProcessProjectProps } from "./project-gatekeeper.js";
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

const NEW_PROJECT_RESOURCE: SupportedResource = {
  urlPattern: "process://new",
  title: "New Process Project",
  description: "Create a new process map linked to this workspace.",
  icon: PROCESS_ICON,
};

const PROJECT_RESOURCE: SupportedResource = {
  urlPattern: "process://project/:projectId",
  title: "Process Project",
  description: "Link a process project you created, and that no workspace has claimed, to this workspace.",
  icon: PROCESS_ICON,
};

const SUPPORTED_RESOURCES: SupportedResource[] = [NEW_PROJECT_RESOURCE, PROJECT_RESOURCE];

const DEFAULT_PROJECT_NAME = "Untitled process";
const PROJECT_PATH = /^\/([A-Za-z0-9-]{1,64})\/?$/;

/** The account app UI needs no capability: projects are opened from their workspaces. */
@validateRpc()
class ProcessStudioAppUi extends RpcTarget {}

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
    return { iframeHtml: APP_HTML, ui: new RpcStub(new ProcessStudioAppUi()) };
  }

  async getSupportedResources(): Promise<SupportedResource[]> {
    return SUPPORTED_RESOURCES;
  }

  /**
   * Mint a stable project ID for new projects, or verify ownership of an existing project.
   * The project itself is created when its facet first claims it.
   */
  async getGatekeeperClassFor(url: string): Promise<{
    class: DurableObjectClass<Gatekeeper<any>>;
    resource: SupportedResource;
  }> {
    const { sharingDomain, accountId } = this.ctx.props;
    const parsed = URL.parse(url);
    if (parsed?.protocol !== "process:") throw new Error(`Unsupported Process Studio URL: ${url}`);

    if (parsed.hostname === "new" && (parsed.pathname === "" || parsed.pathname === "/")) {
      const name = parsed.searchParams.get("name")?.trim() || DEFAULT_PROJECT_NAME;
      if (name.length > MAX_PROJECT_NAME_LENGTH) {
        throw new Error(`Project name must be at most ${MAX_PROJECT_NAME_LENGTH} characters.`);
      }
      const props: ProcessProjectProps = {
        sharingDomain,
        projectId: crypto.randomUUID(),
        creatorAccountId: accountId,
        newProjectName: name,
      };
      return { class: this.ctx.exports.ProcessProjectGatekeeper({ props }), resource: NEW_PROJECT_RESOURCE };
    }

    const projectId = parsed.hostname === "project" ? PROJECT_PATH.exec(parsed.pathname)?.[1] : undefined;
    if (projectId === undefined) throw new Error(`Unsupported Process Studio URL: ${url}`);
    const creator = await this.ctx.exports.ProcessProjectDO
      .getByName(domainName(sharingDomain, projectId))
      .creatorAccountId();
    if (creator !== accountId) throw new Error("Project not found or you do not have access.");
    const props: ProcessProjectProps = { sharingDomain, projectId, creatorAccountId: accountId };
    return { class: this.ctx.exports.ProcessProjectGatekeeper({ props }), resource: PROJECT_RESOURCE };
  }

  startResourceConfigurator(_resourceUrlPattern: string): Promise<ResourceConfiguratorFrame> {
    throw new Error("Process projects are created from Process Studio, not the connections dialog.");
  }

  async ensureResources(_resourceUrlPatterns: string[]): Promise<{ url?: string }> {
    return {};
  }

  /** Leave workspace-owned projects intact when the account is revoked. */
  async revoke(): Promise<void> {}

  reconnect(): Promise<{ url: string }> {
    throw new Error("Process Studio has no connect flow.");
  }

  commitReconnect(_stageId: string): never {
    throw new Error("Process Studio has no connect flow.");
  }

  async getAuthenticatedEmail(): Promise<string | null> {
    return null;
  }

  @skipRpcValidation()
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.ctx.exports.ProcessVerifier({
      props: { sharingDomain: this.ctx.props.sharingDomain },
    });
  }
}

/** The non-standard method `ProcessProjectGatekeeper.addObserver` calls on its own verifier. */
export interface ProcessVerifierApi extends GatekeeperUserVerifier {
  getSharingDomain(): Promise<string>;
}

@validateRpc()
export class ProcessVerifier
  extends WorkerEntrypoint<Cloudflare.Env, { sharingDomain: string }>
  implements ProcessVerifierApi
{
  async getSharingDomain(): Promise<string> {
    return this.ctx.props.sharingDomain;
  }
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

  /** Mint an account scoped to this deployment's sharing domain. */
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
    return SUPPORTED_RESOURCES;
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }
}
