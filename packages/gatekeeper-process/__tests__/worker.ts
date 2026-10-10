import { DurableObject, RpcStub, RpcTarget } from "cloudflare:workers";
import type { ProcessAccount } from "../src/process.js";
import type { ProcessProjectGatekeeper, ProcessProjectProps } from "../src/project-gatekeeper.js";
import type { ChangeReceipt, ChangeSet, ProjectContext } from "../src/types.js";
import type { ApplyResult, OpBatch, PendingPreview, ProjectHandle, ProjectSnapshot } from "../src/ui-types.js";

export { default } from "../src/index.js";
export * from "../src/index.js";
// Vitest's ctx.exports analyzer does not follow the production barrel re-export.
export { ProcessProjectDO } from "../src/project-do.js";
export { ProcessProjectGatekeeper } from "../src/project-gatekeeper.js";
export { ProcessAccount, ProcessVerifier } from "../src/process.js";

type TestExports = {
  ProcessAccount: (options: { props: { sharingDomain: string; accountId: string } }) => Fetcher<ProcessAccount>;
  ProcessProjectGatekeeper: (options: { props: ProcessProjectProps }) => DurableObjectClass<ProcessProjectGatekeeper>;
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
  constructor(readonly submitted: Submitted[], readonly observations: string[]) {
    super();
  }

  async authorizeObservation(description: { title: string }): Promise<void> {
    this.observations.push(description.title);
  }

  async submitAction(id: number, description: Omit<Submitted, "id">): Promise<void> {
    const { title, description: text, descriptionIsComplete, awaitDecision, fields } = description;
    this.submitted.push({ id, title, description: text, descriptionIsComplete, awaitDecision, fields });
  }
}

/** Test stand-in for a workspace: hosts the facet the way the Overseer does, and plays its agent. */
export class ProcessTestWorkspace extends DurableObject<Cloudflare.Env> {
  readonly #props = new Map<string, ProcessProjectProps>();
  readonly submitted: Submitted[] = [];
  readonly observations: string[] = [];

  /** Runs the account's URL checks, then binds as the Overseer would. */
  async bind(binding: string, sharingDomain: string, accountId: string, url: string): Promise<void> {
    const exports = this.ctx.exports as unknown as TestExports;
    await exports.ProcessAccount({ props: { sharingDomain, accountId } }).getGatekeeperClassFor(url);
    const parsed = new URL(url);
    this.#props.set(binding, parsed.hostname === "new"
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

  // ── As the agent ────────────────────────────────────────────────────────────

  async context(binding: string): Promise<ProjectContext> {
    using session = await this.#session(binding);
    return await session.getContext();
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
    return await this.#facet(binding).startSession(new RpcStub(new FakeApprovalQueue(this.submitted, this.observations)));
  }

  async #handle(binding: string): Promise<RpcStub<ProjectHandle & RpcTarget>> {
    const frame = await this.#facet(binding).startUi!();
    return frame.ui as unknown as RpcStub<ProjectHandle & RpcTarget>;
  }

  #require(binding: string): ProcessProjectProps {
    const props = this.#props.get(binding);
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

  /** What the approval queue was asked to show, for assertions. */
  getSubmitted(): Submitted[] {
    return this.submitted;
  }

  getObservations(): string[] {
    return this.observations;
  }
}
