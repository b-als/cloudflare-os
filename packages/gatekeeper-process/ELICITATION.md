# Process Studio — agent elicitation playbook

Expected tool sequence for a greenfield BA workshop on a `ProcessProject` binding.
Observations require `authorizeObservation`; writes go through the approval queue
(register/question/target actions are auto-approvable).

## Greenfield first session

1. **`getContext()`** — read graph, decisions, `openQuestions`, `stakeholders`,
   `interviewTargetStakeholderId`, `coverage`, and `interviewPlan`.
2. **Identify people** — from what the user said, `upsertStakeholder` for each role
   (name, role, stance). Link `userId` when they are a workspace collaborator.
3. **Pick who to ask** — if `interviewTargetStakeholderId` is null and
   `interviewPlan.suggestedNextStakeholderId` is set, call
   `setInterviewTarget(suggestedNextStakeholderId)`. Prefer people whose plan
   `next` is `answer-open`, then `raise-questions`.
4. **Raise assigned questions** — `raiseQuestion({ text, assigneeStakeholderId })`
   for gaps that person can fill (prefer coverage hints that are not yet `done`).
5. **Propose graph only when grounded** — `applyChanges` after the user (or an
   assignee answer) establishes lane/sequence/branch. Do not invent placement.
6. **Respect decisions** — never contradict active locked decisions without
   `supersedes` + rationale.
7. **Clear or rotate the target** — when that interview is done, `setInterviewTarget`
   to the next person or `null`.

## Coverage floor

Treat `coverage` as a floor, not a finish line. After items look `done`, still check
the graph for unreachable steps, dead-end gateway branches, and missing end events.

When the human picks a starter prompt (“interview me” / “from an outline”), prefer this
loop over drafting the graph first: `getContext` → register people → set ask-next →
raise assigned questions for open coverage items → only then `applyChanges`. Workshop
starter text already steers toward that sequence; do not skip straight to a full draft.

## Human path

Stakeholders can also manage the register and ask-next from the Decisions drawer
(`ProjectHandle.upsertStakeholder` / `setInterviewTarget` / `resolveQuestion`) without
waiting on the agent.

## Approvals and revert

- Graph `applyChanges` always needs manual approval; register/question/target actions are
  auto-approvable.
- **`revertAction` is not supported** yet — rejecting before apply is the safe path; after
  apply, undo by a superseding change or manual canvas edit. Do not promise automatic undo.
