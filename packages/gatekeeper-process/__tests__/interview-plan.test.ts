import { describe, expect, it } from "vitest";
import { computeInterviewPlan } from "../src/interview-plan.js";
import type { OpenQuestion, Stakeholder } from "../src/types.js";

const elena: Stakeholder = {
  stakeholderId: "s-elena",
  name: "Elena Voss",
  role: "KYC lead",
  stance: "champion",
  userId: "user-elena",
};
const sam: Stakeholder = {
  stakeholderId: "s-sam",
  name: "Sam Ortiz",
  role: "Ops",
  stance: "supporter",
};

function question(partial: Partial<OpenQuestion> & Pick<OpenQuestion, "questionId" | "text">): OpenQuestion {
  return { nodeIds: [], raisedAt: 1, ...partial };
}

describe("computeInterviewPlan", () => {
  it("is empty when the register is empty", () => {
    expect(computeInterviewPlan([], [], null)).toEqual({
      people: [],
      suggestedNextStakeholderId: null,
    });
  });

  it("marks everyone raise-questions and suggests the first person when no target", () => {
    const plan = computeInterviewPlan([elena, sam], [], null);
    expect(plan.people).toMatchObject([
      { stakeholderId: "s-elena", next: "raise-questions", openQuestionCount: 0, isTarget: false },
      { stakeholderId: "s-sam", next: "raise-questions", openQuestionCount: 0, isTarget: false },
    ]);
    expect(plan.suggestedNextStakeholderId).toBe("s-elena");
  });

  it("prefers someone with open questions over someone who only needs questions raised", () => {
    const plan = computeInterviewPlan(
      [elena, sam],
      [question({ questionId: "q1", text: "Exceptions?", assigneeStakeholderId: "s-sam" })],
      null,
    );
    expect(plan.people.find((p) => p.stakeholderId === "s-sam")).toMatchObject({
      next: "answer-open", openQuestionCount: 1,
    });
    expect(plan.suggestedNextStakeholderId).toBe("s-sam");
  });

  it("counts questions assigned via linked userId", () => {
    const plan = computeInterviewPlan(
      [elena],
      [question({ questionId: "q1", text: "Evidence?", assigneeUserId: "user-elena" })],
      null,
    );
    expect(plan.people[0]).toMatchObject({ next: "answer-open", openQuestionCount: 1 });
  });

  it("marks the interview target as interviewing and keeps them as suggested", () => {
    const plan = computeInterviewPlan(
      [elena, sam],
      [question({ questionId: "q1", text: "?", assigneeStakeholderId: "s-sam" })],
      "s-elena",
    );
    expect(plan.people[0]).toMatchObject({
      stakeholderId: "s-elena", isTarget: true, next: "interviewing",
    });
    expect(plan.suggestedNextStakeholderId).toBe("s-elena");
  });
});
