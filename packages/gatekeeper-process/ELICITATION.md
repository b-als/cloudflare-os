# Process Studio — agent elicitation playbook

Expected tool sequence for a greenfield BA workshop on a `ProcessProject` binding.
Observations require `authorizeObservation`; writes go through the approval queue
(register/question/target actions are auto-approvable).

## Greenfield first session

1. **`getContext()`** — read graph, decisions, `openQuestions`, `stakeholders`,
   `interviewTargetStakeholderId`, and `coverage`.
2. **Identify people** — from what the user said, `upsertStakeholder` for each role
   (name, role, stance). Link `userId` when they are a workspace collaborator.
3. **Pick who to ask** — if `interviewTargetStakeholderId` is null, choose the next
   person who still lacks answers, `setInterviewTarget(id)`.
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

## Human path

Stakeholders can also manage the register and ask-next from the Decisions drawer
(`ProjectHandle.upsertStakeholder` / `setInterviewTarget` / `resolveQuestion`) without
waiting on the agent.
