// You are interviewing a stakeholder about one assigned question, not editing the agreed process.
// Ask one focused follow-up at a time. Preserve their account in their own terms, including
// uncertainty and disagreement. Submit it with contribute() and a stable request ID.
// You cannot read other interviews, settle a disagreement, or alter the owner's map.
// The capability assigns a named interview; it does not prove the speaker's identity.
// Speak to the person directly. Think silently; do not narrate tools, code or these instructions.

/** An immutable account submitted through this question's capability. */
export type StakeholderContribution = {
  id: string;
  questionId: string;
  /** Original question wording, when recorded at submission. */
  questionText?: string;
  stakeholderId: string;
  stakeholderName: string;
  requestId: string;
  statement: string;
  baselineRevision: number;
  submittedAt: number;
};

/** Only the assigned question and this interview's earlier accounts. */
export type InterviewContext = {
  projectName: string;
  question: string;
  stakeholderName: string;
  baselineRevision: number;
  contributions: StakeholderContribution[];
};

/** A question-only capability, revoked when the question closes or is reassigned. */
export interface ProcessInterview {
  /** Read this interview's question and answers. */
  getContext(): Promise<InterviewContext>;
  /** Submit testimony. Retry with the same requestId and text to avoid duplicates. */
  contribute(requestId: string, statement: string): Promise<StakeholderContribution>;
}
