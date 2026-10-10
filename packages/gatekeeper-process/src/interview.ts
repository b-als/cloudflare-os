import { DurableObject, RpcStub, RpcTarget, WorkerEntrypoint } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import type {
  ActionDescription, ActionKind, ApprovalQueue, Gatekeeper, GatekeeperUserVerifier, GitCache,
  HookController, HookInitiator, HookTargetMetadata, ResourceDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import { domainName } from "./domain.js";
import type { InvestigationHookTarget } from "./investigation.js";
import type { ProcessProjectDO } from "./project-do.js";
import type { ProcessVerifierApi } from "./process.js";
import type { InterviewContext, ProcessInterview, StakeholderContribution } from "./types.js";
import INTERVIEW_TYPES from "./interview-types.txt";

/** Authority minted only after the account validates an open question's bearer token. */
export type ProcessInterviewProps = { sharingDomain: string; projectId: string; questionId: string; token: string };

@validateRpc()
class InterviewSession extends RpcTarget implements ProcessInterview {
  constructor(
    private readonly project: DurableObjectStub<ProcessProjectDO>,
    private readonly props: ProcessInterviewProps,
    private readonly queue: RpcStub<ApprovalQueue>,
    private readonly propose: (queue: RpcStub<ApprovalQueue>, reply: StakeholderContribution, description: ActionDescription) => Promise<StakeholderContribution>,
    private readonly pending: () => StakeholderContribution[],
  ) { super(); }

  [Symbol.dispose](): void { this.queue[Symbol.dispose](); }

  async getContext(): Promise<InterviewContext> {
    await this.queue.authorizeObservation({
      title: "Read the assigned interview question",
      description: "Read only this question and the answers submitted through its interview capability.",
    });
    const context = await this.project.interviewContext(this.props.questionId, this.props.token);
    const contributions = new Map(context.contributions.map((reply) => [reply.requestId, reply]));
    for (const reply of this.pending()) if (!contributions.has(reply.requestId)) contributions.set(reply.requestId, reply);
    return { ...context, contributions: [...contributions.values()] };
  }

  async contribute(requestId: string, statement: string): Promise<StakeholderContribution> {
    const reply = await this.project.prepareContribution(this.props.questionId, this.props.token, requestId, statement);
    return this.propose(this.queue, reply, {
      title: "Send your account to the analyst",
      description: "This records testimony, not agreement with the process map or consent to a proposed change.",
      fields: [
        { label: "Your account", kind: "text", value: statement },
        { label: "Assigned interview", kind: "text", value: reply.stakeholderName },
        { label: "Request ID", kind: "inline", value: requestId },
      ],
      descriptionIsComplete: false,
      implementsRevert: false,
      awaitDecision: true,
    });
  }
}

/** A separate workspace can hold this capability without gaining any project-edit authority. */
@validateRpc()
export class ProcessInterviewGatekeeper extends DurableObject<Cloudflare.Env, ProcessInterviewProps>
  implements Gatekeeper<ProcessInterview> {
  #ready = false;

  async describe(): Promise<ResourceDescription> {
    const context = await this.#project().interviewContext(this.ctx.props.questionId, this.ctx.props.token);
    return {
      // Do not reveal the bearer token in metadata shown to workspace collaborators.
      url: `process://interview/${this.ctx.props.projectId}/${this.ctx.props.questionId}`,
      title: `${context.stakeholderName}: ${context.projectName}`,
      snippet: context.question, suggestedBindingName: "PROCESS_INTERVIEW", tsType: "ProcessInterview",
    };
  }

  async getTypeScriptTypes(): Promise<string> { return INTERVIEW_TYPES; }
  async getAutoApprovableActions(): Promise<ActionKind[]> { return []; }

  async startSession(queue: RpcStub<ApprovalQueue>): Promise<ProcessInterview> {
    await this.#project().interviewContext(this.ctx.props.questionId, this.ctx.props.token);
    return new InterviewSession(this.#project(), this.ctx.props, queue.dup(),
      (approvalQueue, reply, description) => this.#propose(approvalQueue, reply, description),
      () => this.#sql().exec<{ payload: string }>("SELECT payload FROM interview_proposals ORDER BY action_id")
        .toArray().map((row) => JSON.parse(row.payload) as StakeholderContribution));
  }

  async addObserver(_id: string, user: Fetcher<GatekeeperUserVerifier>): Promise<void> {
    const verifier = user as Fetcher<ProcessVerifierApi>;
    if (await verifier.getSharingDomain() !== this.ctx.props.sharingDomain) throw new Error("Interview belongs to another deployment.");
    await this.#project().interviewContext(this.ctx.props.questionId, this.ctx.props.token);
  }
  async removeObserver(_id: string): Promise<void> {}

  async applyAction(id: number, _cache: RpcStub<GitCache>): Promise<void> {
    const row = this.#sql().exec<{ payload: string }>("SELECT payload FROM interview_proposals WHERE action_id = ?", id).toArray()[0];
    if (!row) throw new Error("Unknown interview reply.");
    await this.#project().contribute(this.ctx.props.questionId, this.ctx.props.token, JSON.parse(row.payload) as StakeholderContribution);
    this.#sql().exec("DELETE FROM interview_proposals WHERE action_id = ?", id);
  }

  async rejectAction(id: number): Promise<void> {
    this.#sql().exec("DELETE FROM interview_proposals WHERE action_id = ?", id);
  }
  async revertAction(_id: number): Promise<void> { throw new Error("Submitted testimony is immutable; send a correction instead."); }

  #sql(): SqlStorage {
    const sql = this.ctx.storage.sql;
    if (!this.#ready) {
      sql.exec("CREATE TABLE IF NOT EXISTS interview_proposals (action_id INTEGER PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL)");
      this.#ready = true;
    }
    return sql;
  }

  async #propose(queue: RpcStub<ApprovalQueue>, reply: StakeholderContribution, description: ActionDescription): Promise<StakeholderContribution> {
    const pending = this.#sql().exec<{ payload: string }>("SELECT payload FROM interview_proposals WHERE request_id = ?", reply.requestId).toArray()[0];
    if (pending) {
      if ((JSON.parse(pending.payload) as StakeholderContribution).statement !== reply.statement) throw new Error("This request already has different text.");
      return JSON.parse(pending.payload) as StakeholderContribution;
    }
    const accepted = await this.#project().interviewContext(this.ctx.props.questionId, this.ctx.props.token);
    const existing = accepted.contributions.find((item) => item.requestId === reply.requestId);
    if (existing) {
      if (existing.statement !== reply.statement) throw new Error("This request already has different text.");
      return existing;
    }
    const raced = this.#sql().exec<{ payload: string }>("SELECT payload FROM interview_proposals WHERE request_id = ?", reply.requestId).toArray()[0];
    if (raced) {
      const other = JSON.parse(raced.payload) as StakeholderContribution;
      if (other.statement !== reply.statement) throw new Error("This request already has different text.");
      return other;
    }
    const id = this.ctx.storage.kv.get<number>("nextActionId") ?? 1;
    this.ctx.storage.kv.put("nextActionId", id + 1);
    this.#sql().exec("INSERT INTO interview_proposals VALUES (?, ?, ?)", id, reply.requestId, JSON.stringify(reply));
    try { await queue.submitAction(id, description); }
    catch (error) {
      this.#sql().exec("DELETE FROM interview_proposals WHERE action_id = ?", id);
      throw error;
    }
    return reply;
  }

  #project(): DurableObjectStub<ProcessProjectDO> {
    return this.ctx.exports.ProcessProjectDO.getByName(domainName(this.ctx.props.sharingDomain, this.ctx.props.projectId));
  }
}

/** Workshop alone controls activation; an old disabled registration cannot erase its replacement. */
@validateRpc()
export class ProcessInvestigationController extends WorkerEntrypoint<Cloudflare.Env, { sharingDomain: string; projectId: string; id: string }>
  implements HookController<InvestigationHookTarget> {
  async enable(initiator: Fetcher<HookInitiator<InvestigationHookTarget>>, _target: HookTargetMetadata): Promise<void> {
    await this.#project().setInvestigationWatch(this.ctx.props.id, initiator);
  }
  async disable(): Promise<void> { await this.#project().setInvestigationWatch(this.ctx.props.id, null); }
  #project(): DurableObjectStub<ProcessProjectDO> {
    return this.ctx.exports.ProcessProjectDO.getByName(domainName(this.ctx.props.sharingDomain, this.ctx.props.projectId));
  }
}
