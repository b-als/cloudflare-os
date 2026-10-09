# Process Studio — agent elicitation playbook

Expected tool sequence for a greenfield BA workshop on a `ProcessProject` binding.
Observations require `authorizeObservation`; writes go through the approval queue
(register/question/target actions are auto-approvable).

## Greenfield first session

1. **`getContext()`** — read graph, decisions, `openQuestions`, `stakeholders`,
   `takeaways`, `interviewTargetStakeholderId`, `coverage`, and `interviewPlan`.
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
6. **Capture takeaways** — when a finding should persist (as-is / to-be note,
   requirement, or pain point), `upsertTakeaway({ kind, text, nodeIds? })`. Prefer
   tying it to step IDs when it concerns a specific node.
7. **Respect decisions** — never contradict active locked decisions without
   `supersedes` + rationale.
8. **Clear or rotate the target** — when that interview is done, `setInterviewTarget`
   to the next person or `null`.

## Coverage floor

Treat `coverage` as a floor, not a finish line. After items look `done`, still check
the graph for unreachable steps, dead-end gateway branches, and missing end events.

When the human picks a starter prompt (“interview me” / “from an outline”), prefer this
loop over drafting the graph first: `getContext` → register people → set ask-next →
raise assigned questions for open coverage items → only then `applyChanges`. Workshop
starter text already steers toward that sequence; do not skip straight to a full draft.

## Messy real answers

Stakeholder replies are rarely clean. Handle them with tools, not by inventing a tidy
story on the canvas.

### Contradictions

- Two people (or one person across turns) disagree on trigger, sequence, owner, or
  exception path: **do not pick a winner** in `applyChanges`.
- Raise a focused clarifying question (`raiseQuestion`) assigned to the person who can
  decide, or to both when the conflict is unresolved. Name the conflict in the question
  text (what A said vs what B said).
- If a locked decision already settled the point, cite it and ask whether to supersede;
  never silently overwrite.
- Keep both accounts in open questions / rationale until one answer is approved as a
  decision. Partial graph drafts that encode only one side are out of play.

### Unknown / “I don’t know”

- Treat “unknown”, “not sure”, “ask Ops”, and silence as **signals**, not empty answers
  you can fill in.
- Leave that coverage item open. Re-assign or raise a new question to whoever they named
  (`upsertStakeholder` if missing, then `setInterviewTarget` / assignee).
- Do **not** invent owners, systems, durations, or exception branches to close the gap.
- If nobody knows yet, record the gap with `raiseQuestion` (unassigned or on the BA) and
  move to the next grounded coverage item — do not stall the whole map on one unknown.

### Scope creep

- New goals, adjacent processes, “while we’re at it” systems, or org-wide redesigns that
  were not in the current project’s stated scope: **pause before expanding the graph**.
- Confirm whether the new material belongs in *this* process map. Prefer
  `raiseQuestion` (“Is X in scope for this workshop, or a separate process?”) over adding
  lanes/nodes for the tangent.
- If the user confirms a scope change, upsert any new stakeholders and capture the
  decision (rationale) before large `applyChanges`. If they defer it, leave a question and
  stay on the original happy path / exceptions.
- Do not let outline dumps from another process overwrite placement already established
  by active decisions.

### Compact recovery loop

Whenever an answer is contradictory, unknown, or off-scope:

1. `getContext()` — re-read coverage, `interviewPlan`, and active decisions.
2. Register or retarget people if the answer named someone new.
3. `raiseQuestion` capturing the mess (conflict / unknown / scope check), assigned when
   possible.
4. Only then `applyChanges` for facts that remain uncontested and placement-clear.
5. Rotate `setInterviewTarget` when the current person’s thread is blocked on someone else.

## Human path

Stakeholders can also manage the register, takeaways, and ask-next from the Decisions
drawer (`ProjectHandle.upsertStakeholder` / `upsertTakeaway` / `setInterviewTarget` /
`resolveQuestion`) without waiting on the agent.

## Approvals and revert

- Graph `applyChanges` always needs manual approval; register/question/target/takeaway
  actions are auto-approvable.
- **`revertAction` is not supported** yet — rejecting before apply is the safe path; after
  apply, undo by a superseding change or manual canvas edit. Do not promise automatic undo.
