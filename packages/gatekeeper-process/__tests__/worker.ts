import { DurableObject, RpcStub, RpcTarget, WorkerEntrypoint } from "cloudflare:workers";
import type { HookController } from "@gadgets/workshop-shared/gatekeeper";
import type { InvestigationHookTarget } from "../src/investigation.js";
import type { ProcessInterviewGatekeeper, ProcessInterviewProps } from "../src/interview.js";
import type { ProcessAccount } from "../src/process.js";
import type { ProcessProjectGatekeeper, ProcessProjectProps } from "../src/project-gatekeeper.js";
import type { ChangeReceipt, ChangeSet, InterviewContext, InvestigationEvent, ProjectContext, ProjectDocumentKind, StakeholderContribution } from "../src/types.js";
import type { ApplyResult, OpBatch, PendingPreview, ProjectHandle, ProjectSnapshot } from "../src/ui-types.js";

export { default } from "../src/index.js";
export * from "../src/index.js";
// Vitest's ctx.exports analyzer does not follow the production barrel re-export.
export { ProcessProjectDO } from "../src/project-do.js";
export { ProcessProjectGatekeeper } from "../src/project-gatekeeper.js";
export { ProcessAccount, ProcessVerifier } from "../src/process.js";
export { ProcessInterviewGatekeeper, ProcessInvestigationController } from "../src/interview.js";

type TestExports = {
  ProcessAccount: (options: { props: { sharingDomain: string; accountId: string } }) => Fetcher<ProcessAccount>;
  ProcessProjectGatekeeper: (options: { props: ProcessProjectProps }) => DurableObjectClass<ProcessProjectGatekeeper>;
  ProcessInterviewGatekeeper: (options: { props: ProcessInterviewProps }) => DurableObjectClass<ProcessInterviewGatekeeper>;
  TestInvestigationInitiator: (options: { props: { workspaceId: string } }) => Fetcher<TestInvestigationInitiator>;
};

/** What the agent's approval queue was asked to show the person. */
export type Submitted = {
  id: number;
  title: string;
  description: string;
  descriptionIsComplete?: boolean;
  awaitDecision?: boolean;
  fields?: unknown[];
};

class UnusedGitCache extends RpcTarget {}

class FakeApprovalQueue extends RpcTarget {
  #disposed!: () => void;
  readonly disposed = new Promise<void>((resolve) => { this.#disposed = resolve; });
  constructor(readonly submitted: Submitted[], readonly observations: string[],
    readonly hook?: (controller: Fetcher<HookController<InvestigationHookTarget>>) => void) {
    super();
  }

  async authorizeObservation(description: { title: string }): Promise<void> {
    this.observations.push(description.title);
  }

  async submitAction(id: number, description: Omit<Submitted, "id">): Promise<void> {
    const { title, description: text, descriptionIsComplete, awaitDecision, fields } = description;
    this.submitted.push({ id, title, description: text, descriptionIsComplete, awaitDecision, fields });
  }

  async bindHook(controller: Fetcher<HookController<InvestigationHookTarget>>): Promise<void> {
    if (!this.hook) throw new Error("This test session does not support hooks.");
    this.hook(controller);
  }
  [Symbol.dispose](): void { this.#disposed(); }
}

/** Test stand-in for a workspace: hosts the facet the way the Overseer does, and plays its agent. */
export class ProcessTestWorkspace extends DurableObject<Cloudflare.Env> {
  readonly submitted: Submitted[] = [];
  readonly observations: string[] = [];

  /** Runs the account's URL checks, then binds as the Overseer would. */
  async bind(binding: string, sharingDomain: string, accountId: string, url: string): Promise<void> {
    const exports = this.ctx.exports as unknown as TestExports;
    await exports.ProcessAccount({ props: { sharingDomain, accountId } }).getGatekeeperClassFor(url);
    const parsed = new URL(url);
    this.ctx.storage.kv.put(`binding:${binding}`, parsed.hostname === "new"
      ? { sharingDomain, projectId: crypto.randomUUID(), creatorAccountId: accountId,
        newProjectName: parsed.searchParams.get("name") ?? "Untitled process" }
      : { sharingDomain, projectId: parsed.pathname.slice(1), creatorAccountId: accountId });
  }

  projectId(binding: string): string {
    return this.#require(binding).projectId;
  }

  async describe(binding: string): Promise<{ url: string; title: string; tsType: string }> {
    const { url, title, tsType } = await this.#facet(binding).describe();
    return { url, title, tsType };
  }

  async autoApprovable(binding: string): Promise<number> {
    return (await this.#facet(binding).getAutoApprovableActions()).length;
  }

  async interviewUrl(binding: string, questionId: string): Promise<string> {
    using session = await this.#session(binding);
    return await session.getInterviewUrl(questionId);
  }

  async bindInterview(binding: string, sharingDomain: string, accountId: string, url: string): Promise<void> {
    const exports = this.ctx.exports as unknown as TestExports;
    await exports.ProcessAccount({ props: { sharingDomain, accountId } }).getGatekeeperClassFor(url);
    const parsed = new URL(url);
    const [projectId, questionId] = parsed.pathname.slice(1).split("/");
    this.ctx.storage.kv.put(`interview:${binding}`, { sharingDomain, projectId, questionId, token: parsed.searchParams.get("token")! });
  }

  async interviewContext(binding: string): Promise<InterviewContext> {
    using session = await this.#interview(binding).startSession(new RpcStub(new FakeApprovalQueue(this.submitted, this.observations)));
    return await session.getContext();
  }

  async reply(binding: string, requestId: string, statement: string): Promise<StakeholderContribution> {
    using session = await this.#interview(binding).startSession(new RpcStub(new FakeApprovalQueue(this.submitted, this.observations)));
    return await session.contribute(requestId, statement);
  }

  async acceptReply(binding: string): Promise<void> {
    using cache = new RpcStub(new UnusedGitCache());
    await this.#interview(binding).applyAction(this.submitted.at(-1)!.id, cache);
  }

  async registerWatch(binding: string): Promise<void> {
    using session = await this.#session(binding);
    await session.watch(new RpcStub(new TestInvestigationCallback(this)));
  }

  async enableWatch(): Promise<void> {
    const exports = this.ctx.exports as unknown as TestExports;
    const controller = this.ctx.storage.kv.get<Fetcher<HookController<InvestigationHookTarget>>>("controller")!;
    await controller.enable(exports.TestInvestigationInitiator({ props: { workspaceId: this.ctx.id.toString() } }), { workspaceId: this.ctx.id.toString() });
  }

  async disableWatch(): Promise<void> {
    await this.ctx.storage.kv.get<Fetcher<HookController<InvestigationHookTarget>>>("controller")!.disable();
  }

  async disablePreviousWatch(): Promise<void> {
    await this.ctx.storage.kv.get<Fetcher<HookController<InvestigationHookTarget>>>("previousController")!.disable();
  }

  async recordInvestigation(event: InvestigationEvent): Promise<boolean> {
    const failures = this.ctx.storage.kv.get<number>("callbackFailures") ?? 0;
    if (failures > 0) {
      this.ctx.storage.kv.put("callbackFailures", failures - 1);
      return false;
    }
    const events = this.events();
    events.push(event);
    this.ctx.storage.kv.put("events", events);
    return true;
  }

  failCallbacks(count: number): void { this.ctx.storage.kv.put("callbackFailures", count); }
  events(): InvestigationEvent[] { return this.ctx.storage.kv.get<InvestigationEvent[]>("events") ?? []; }

  // ── As the agent ────────────────────────────────────────────────────────────

  async context(binding: string): Promise<ProjectContext> {
    using session = await this.#session(binding);
    return await session.getContext();
  }

  async document(binding: string, kind: ProjectDocumentKind): Promise<string> {
    using session = await this.#session(binding);
    return await session.getDocument(kind);
  }

  async propose(binding: string, change: ChangeSet): Promise<{ receipt?: ChangeReceipt; error?: string }> {
    using session = await this.#session(binding);
    try {
      return { receipt: await session.applyChanges(change) };
    } catch (error) {
      return { error: String(error) };
    }
  }

  /** The person's decision on the last proposal, as the Overseer delivers it. */
  async decide(binding: string, decision: "apply" | "reject", actionId?: number): Promise<{ error?: string }> {
    const id = actionId ?? this.submitted.at(-1)?.id;
    if (id === undefined) throw new Error("Nothing was proposed.");
    try {
      if (decision === "apply") {
        using cache = new RpcStub(new UnusedGitCache());
        await this.#facet(binding).applyAction(id, cache);
      } else {
        await this.#facet(binding).rejectAction(id);
      }
      return {};
    } catch (error) {
      return { error: String(error) };
    }
  }

  // ── As the person's map ─────────────────────────────────────────────────────

  async snapshot(binding: string): Promise<ProjectSnapshot> {
    using handle = await this.#handle(binding);
    return await handle.snapshot();
  }

  async edit(binding: string, batch: OpBatch): Promise<ApplyResult> {
    using handle = await this.#handle(binding);
    return await handle.applyOps(batch);
  }

  async preview(binding: string): Promise<PendingPreview> {
    using handle = await this.#handle(binding);
    return await handle.previewPending();
  }

  async observe(binding: string, sharingDomain: string): Promise<void> {
    const exports = this.ctx.exports as unknown as TestExports;
    const verifier = await exports.ProcessAccount({ props: { sharingDomain, accountId: "observer" } }).getVerifier();
    await this.#facet(binding).addObserver("observer", verifier);
  }

  async #session(binding: string) {
    return await this.#facet(binding).startSession(new RpcStub(new FakeApprovalQueue(this.submitted, this.observations,
      (controller) => {
        const previous = this.ctx.storage.kv.get<Fetcher<HookController<InvestigationHookTarget>>>("controller");
        if (previous) this.ctx.storage.kv.put("previousController", previous);
        this.ctx.storage.kv.put("controller", controller);
      })));
  }

  async #handle(binding: string): Promise<RpcStub<ProjectHandle & RpcTarget>> {
    const frame = await this.#facet(binding).startUi!();
    return frame.ui as unknown as RpcStub<ProjectHandle & RpcTarget>;
  }

  #require(binding: string): ProcessProjectProps {
    const props = this.ctx.storage.kv.get<ProcessProjectProps>(`binding:${binding}`);
    if (!props) throw new Error(`No binding ${binding}.`);
    return props;
  }

  #facet(binding: string): DurableObjectStub<ProcessProjectGatekeeper> {
    const props = this.#require(binding);
    const exports = this.ctx.exports as unknown as TestExports;
    return this.ctx.facets.get<ProcessProjectGatekeeper>(binding, () => ({
      class: exports.ProcessProjectGatekeeper({ props }),
    }));
  }

  #interview(binding: string): DurableObjectStub<ProcessInterviewGatekeeper> {
    const props = this.ctx.storage.kv.get<ProcessInterviewProps>(`interview:${binding}`);
    if (!props) throw new Error("Interview is not bound.");
    const exports = this.ctx.exports as unknown as TestExports;
    return this.ctx.facets.get<ProcessInterviewGatekeeper>(binding, () => ({ class: exports.ProcessInterviewGatekeeper({ props }) }));
  }

  /** What the approval queue was asked to show, for assertions. */
  getSubmitted(): Submitted[] {
    return this.submitted;
  }

  getObservations(): string[] {
    return this.observations;
  }
}

class TestInvestigationCallback extends RpcTarget {
  #disposed!: () => void;
  readonly disposed = new Promise<void>((resolve) => { this.#disposed = resolve; });
  constructor(private readonly workspace: Pick<ProcessTestWorkspace, "recordInvestigation">) { super(); }
  async onInvestigation(event: InvestigationEvent): Promise<void> {
    if (!await this.workspace.recordInvestigation(event)) throw new Error("Test callback failed.");
  }
  [Symbol.dispose](): void { this.#disposed(); }
}

/** Persistable initiator that reconstructs its callback after project/host eviction. */
export class TestInvestigationInitiator extends WorkerEntrypoint<Cloudflare.Env, { workspaceId: string }>
{
  async startHook() {
    const workspace = this.env.WORKSPACE.get(this.env.WORKSPACE.idFromString(this.ctx.props.workspaceId)) as DurableObjectStub<ProcessTestWorkspace>;
    const callback = new TestInvestigationCallback(workspace);
    const approvalQueue = new FakeApprovalQueue([], []);
    // Keep the non-actor session alive until its returned targets are released, as in scheduler tests.
    this.ctx.waitUntil((async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all([callback.disposed, approvalQueue.disposed]),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, 5000); }),
        ]);
      } finally { clearTimeout(timer); }
    })());
    return { callback, approvalQueue };
  }
}
