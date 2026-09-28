import { DurableObject, RpcStub, RpcTarget } from "cloudflare:workers";
import type { ProcessAccount } from "../src/process.js";
import type { ProcessProjectGatekeeper, ProcessProjectProps } from "../src/project-gatekeeper.js";
import type { ChangeSet, ProcessGraph, ProjectContext } from "../src/types.js";
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
  readonly submitted: Array<{ id: number; title: string; description: string }>;

  constructor(events: string[], reject: boolean, submitted: FakeApprovalQueue["submitted"] = []) {
    super();
    this.#events = events;
    this.#reject = reject;
    this.submitted = submitted;
  }

  async authorizeObservation(description: { title: string }): Promise<void> {
    this.#events.push(`authorize:${description.title}`);
    if (this.#reject) throw new Error("observation rejected");
  }

  async submitAction(id: number, description: { title: string; description: string }): Promise<void> {
    this.submitted.push({ id, title: description.title, description: description.description });
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

  /** Proposes `change` as the agent, then approves or rejects every submitted action. */
  async proposeAsAgent(binding: string, change: ChangeSet, decide: "apply" | "reject" | "none",
      question?: string): Promise<{
    submitted: Array<{ id: number; title: string; description: string }>;
    simulated: ProjectContext;
    committed: ProjectSnapshot;
    after: ProjectContext;
    errors: string[];
  }> {
    const submitted: Array<{ id: number; title: string; description: string }> = [];
    const facet = this.#facet(binding);
    const session = await facet.startSession(new RpcStub(new FakeApprovalQueue([], false, submitted)));
    const errors: string[] = [];
    try {
      await session.applyChanges(change);
      if (question) await session.raiseQuestion({ text: question });
    } catch (error) {
      errors.push(String(error));
    }
    const simulated = await session.getContext();
    for (const { id } of submitted) {
      try {
        if (decide === "apply") await facet.applyAction(id);
        if (decide === "reject") await facet.rejectAction(id);
      } catch (error) {
        errors.push(String(error));
      }
    }
    const frame = await facet.startUi!();
    const committed = await (frame.ui as unknown as RpcStub<ProjectHandle & RpcTarget>).snapshot();
    return { submitted, simulated, committed, after: await session.getContext(), errors };
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

  async lockNode(binding: string, nodeId: string): Promise<{ decisionId: string }> {
    const frame = await this.#facet(binding).startUi!();
    const handle = frame.ui as unknown as RpcStub<ProjectHandle & RpcTarget>;
    const { decisionId } = await handle.recordDecision({
      summary: "Lead signed off", rationale: "", nodeIds: [nodeId], edgeIds: [],
    });
    return { decisionId };
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
