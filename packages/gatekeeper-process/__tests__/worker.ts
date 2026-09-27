import { DurableObject, RpcStub, RpcTarget } from "cloudflare:workers";
import type { ProcessAccount } from "../src/process.js";
import type { ProcessProjectGatekeeper, ProcessProjectProps } from "../src/project-gatekeeper.js";
import type { ProcessGraph, ProjectContext } from "../src/types.js";
import type { ApplyResult, OpBatch, ProjectHandle, ProjectSnapshot } from "../src/ui-types.js";

export { default } from "../src/index.js";
export * from "../src/index.js";
// Vitest's ctx.exports analyzer does not follow the production barrel re-export.
export { ProcessProjectDO } from "../src/project-do.js";
export { ProcessProjectGatekeeper } from "../src/project-gatekeeper.js";
export { ProcessAccount, ProcessVerifier } from "../src/process.js";

type TestExports = {
  ProcessAccount: (options: { props: { sharingDomain: string; accountId: string } }) =>
    Fetcher<ProcessAccount>;
  ProcessProjectGatekeeper: (options: { props: ProcessProjectProps }) =>
    DurableObjectClass<ProcessProjectGatekeeper>;
};

class FakeApprovalQueue extends RpcTarget {
  readonly #events: string[];
  readonly #reject: boolean;

  constructor(events: string[], reject: boolean) {
    super();
    this.#events = events;
    this.#reject = reject;
  }

  async authorizeObservation(description: { title: string }): Promise<void> {
    this.#events.push(`authorize:${description.title}`);
    if (this.#reject) throw new Error("observation rejected");
  }
}

/** Test-only Overseer stand-in: hosts ProcessProjectGatekeeper facets like a workspace does. */
export class ProcessTestWorkspace extends DurableObject<Cloudflare.Env> {
  readonly #props = new Map<string, ProcessProjectProps>();

  // Runs the account's URL checks, then builds the facet class locally, like Scheduler's harness.
  async bind(binding: string, sharingDomain: string, accountId: string, url: string): Promise<void> {
    const exports = this.ctx.exports as unknown as TestExports;
    await exports.ProcessAccount({ props: { sharingDomain, accountId } }).getGatekeeperClassFor(url);
    const parsed = new URL(url);
    this.#props.set(binding, parsed.hostname === "new"
      ? {
        sharingDomain,
        projectId: crypto.randomUUID(),
        creatorAccountId: accountId,
        newProjectName: parsed.searchParams.get("name") ?? "Untitled process",
      }
      : { sharingDomain, projectId: parsed.pathname.slice(1), creatorAccountId: accountId });
  }

  async describe(binding: string): Promise<{ url: string; title: string; tsType: string }> {
    const { url, title, tsType } = await this.#facet(binding).describe();
    return { url, title, tsType };
  }

  async read(binding: string, reject = false): Promise<{
    events: string[];
    context?: ProjectContext;
    graph?: ProcessGraph;
    error?: string;
  }> {
    const events: string[] = [];
    const session = await this.#facet(binding)
      .startSession(new RpcStub(new FakeApprovalQueue(events, reject)));
    try {
      const context = await session.getContext();
      events.push("returned:context");
      const graph = await session.getGraph();
      events.push("returned:graph");
      return { events, context, graph };
    } catch (error) {
      return { events, error: String(error) };
    }
  }

  async proposeAsAgent(binding: string): Promise<string[]> {
    const session = await this.#facet(binding).startSession(
      new RpcStub(new FakeApprovalQueue([], false)),
    );
    const errors: string[] = [];
    for (const attempt of [
      () => session.applyChanges({ summary: "s", rationale: "r", ops: [] }),
      () => session.raiseQuestion({ text: "q" }),
    ]) {
      try {
        await attempt();
      } catch (error) {
        errors.push(String(error));
      }
    }
    return errors;
  }

  async editThroughUi(binding: string, batch: OpBatch): Promise<{
    html: string;
    result: ApplyResult;
    snapshot: ProjectSnapshot;
  }> {
    const frame = await this.#facet(binding).startUi!();
    const handle = frame.ui as unknown as RpcStub<ProjectHandle & RpcTarget>;
    const result = await handle.applyOps(batch);
    const snapshot = await handle.snapshot();
    return { html: frame.iframeHtml, result, snapshot };
  }

  async observe(binding: string, sharingDomain: string): Promise<void> {
    const exports = this.ctx.exports as unknown as TestExports;
    const verifier = await exports.ProcessAccount({
      props: { sharingDomain, accountId: "observer" },
    }).getVerifier();
    await this.#facet(binding).addObserver("observer", verifier);
  }

  #facet(binding: string): DurableObjectStub<ProcessProjectGatekeeper> {
    const props = this.#props.get(binding);
    if (!props) throw new Error(`No binding ${binding}.`);
    const exports = this.ctx.exports as unknown as TestExports;
    return this.ctx.facets.get<ProcessProjectGatekeeper>(binding, () => ({
      class: exports.ProcessProjectGatekeeper({ props }),
    }));
  }
}
