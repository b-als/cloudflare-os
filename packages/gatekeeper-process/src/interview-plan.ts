import type {
  InterviewPlan,
  InterviewPlanNext,
  InterviewPlanPerson,
  OpenQuestion,
  Stakeholder,
} from "./types.js";

export type { InterviewPlan, InterviewPlanNext, InterviewPlanPerson };

function openCountFor(
  stakeholder: Stakeholder,
  openQuestions: OpenQuestion[],
): number {
  return openQuestions.filter((question) => {
    if (question.assigneeStakeholderId === stakeholder.stakeholderId) return true;
    return (
      stakeholder.userId !== undefined &&
      question.assigneeUserId === stakeholder.userId
    );
  }).length;
}

/**
 * Builds a lightweight people checklist for the agent: who is ask-next, who has open assigned
 * questions, and who still needs questions raised. Derived only — nothing is persisted.
 */
export function computeInterviewPlan(
  stakeholders: Stakeholder[],
  openQuestions: OpenQuestion[],
  interviewTargetStakeholderId: string | null,
): InterviewPlan {
  const people: InterviewPlanPerson[] = stakeholders.map((person) => {
    const openQuestionCount = openCountFor(person, openQuestions);
    const isTarget = person.stakeholderId === interviewTargetStakeholderId;
    const next: InterviewPlanNext = isTarget
      ? "interviewing"
      : openQuestionCount > 0
        ? "answer-open"
        : "raise-questions";
    return {
      stakeholderId: person.stakeholderId,
      name: person.name,
      role: person.role,
      isTarget,
      openQuestionCount,
      next,
    };
  });

  let suggestedNextStakeholderId: string | null = interviewTargetStakeholderId;
  if (suggestedNextStakeholderId === null) {
    const withOpen = people.find((person) => person.next === "answer-open");
    const needsRaise = people.find((person) => person.next === "raise-questions");
    suggestedNextStakeholderId =
      withOpen?.stakeholderId ?? needsRaise?.stakeholderId ?? null;
  }

  return { people, suggestedNextStakeholderId };
}
