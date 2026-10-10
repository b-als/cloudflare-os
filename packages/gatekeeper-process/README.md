# Process Studio gatekeeper

The backend of BA Studio's chat-first process mapping (see
[docs/ba-studio-charter.md](../../docs/ba-studio-charter.md)). A person talks to the Workshop agent;
the agent proposes changes to a process map through this gatekeeper; the person sees each proposal
drawn on the map and accepts or rejects it in the conversation.

## What it holds

One SQLite Durable Object per project (`ProcessProjectDO`), linked to the one workspace whose binding
first uses it:

- **The map**: lanes, steps (with owner, system, inputs, outputs, duration and pain points) and flows.
- **Decisions**: every accepted agent change, with its summary and rationale, so later conversations
  build on what was settled.
- **A change log** of the last 500 changes, so an open map catches up on what it missed.
- **Connected project knowledge**: stakeholders and their decision authority, outcomes and measures,
  step responsibilities, evidence and assumptions, risks, alternatives and outstanding questions.
  These are records behind the conversation, not screens or a reinstated ten-stage lifecycle.
- **Immutable testimony**: each interview's submitted accounts retain its assigned stakeholder name,
  original question wording, map baseline and request ID. Older accounts without a question snapshot
  are labelled as such, never assigned a guessed question. They do not overwrite facts or resolve questions.
- **Investigation delivery**: a durable outbox for replies and question deadlines, including failed
  deliveries. It uses the project's existing alarm, not a polling LLM.

## Two capabilities

- **The agent's session** (`startSession`) can read the map (each read is an observation) and
  propose changes with `applyChanges()`. Every proposal goes through the approval queue with
  `awaitDecision`, so the conversation waits for the person, and none is auto-approvable. The agent
  contract is [src/types.d.ts](src/types.d.ts), which is also the agent's instructions.
  `knowledgeOps` can accompany map edits in one atomic `applyChanges()` proposal, or a knowledge-only
  proposal can have `ops: []`. Its knowledge revision is checked again on acceptance: stale synthesis
  cannot overwrite another knowledge decision. References must exist, an assumption cannot be
  verified evidence, and each step can have at most one accountable stakeholder.
  Overtaken proposals are reported in context and the map preview, rather than partially simulated.
  Direct deletion of a linked step returns a rejection; remove or reassign its knowledge links in
  the same agent proposal when the deletion is intended.
  [src/types.txt](src/types.txt) must resolve to the declaration (an exact copy on Windows checkouts);
  `scripts/gatekeeper-types.test.ts` checks both agent contracts.
- **The person's map** (`startUi`) reads the project, streams live changes, previews pending
  proposals (including the lanes a first draft adds), re-lays the map in flow order, and applies
  direct edits. An edit conflicts only if it touches a step or flow someone changed since the
  editor last saw it.

## Documents are derived, not separately maintained

Ask the analyst for a project brief, stakeholders, responsibilities (RACI), risks, trade-offs or
evidence. `getDocument()` produces Markdown from **accepted** state, never pending proposals.
Responsibility documents name unassigned accountability explicitly; the exporter does not infer it
from lane names or manufacture it. Evidence includes source and reported/verified/disputed status.
No additional document screen or register is required.

## Independent stakeholder interviews

After an open question is accepted, `getInterviewUrl(questionId)` returns a bearer resource URL.
The analyst gives the participant a same-origin link to `/ba-projects/interview#` followed by the
URL encoded with `encodeURIComponent`. The fragment keeps the bearer out of HTTP paths and queries.
The participant signs in through Workshop; the page creates an isolated workspace bound only to
`ProcessInterview`. It has one conversation, no map or platform navigation. It does not require
Workshop onboarding or billing setup; authentication and resource authorisation still apply.

The interview may read its question and its own answers, and propose an append-only answer for
the participant to send. The owner sees accepted testimony in project context and can propose an
evidence-backed synthesis separately. Neither testimony nor an overdue question is consent.
Closing, cancelling or reassigning a question revokes its old capability, including held sessions
and pending replies. An assigned name is **not verified identity**: anyone holding the bearer can
answer that interview, so do not use the assignment as proof of who spoke.

Reply retries reuse `requestId`; reusing it with different text is rejected. New corrections use
a new request ID and leave the original account intact.

## Persistent follow-through

From the existing conversation's `executeCode`, call `PROCESS_PROJECT.watch(self)`. Workshop's
`self` is a persistent callback to that same chat; no gadget code or second agent is needed.
Registration is initially disabled. The user enables the hook in Workshop Connections.
One registration is active per project: enabling a replacement takes over, and disabling an older
registration cannot stop it. Do not register repeatedly on each turn.

The project stores only Workshop's `HookInitiator`, never a session-bound callback. Each delivery
obtains a fresh firing, records an observation and calls `onInvestigation(event)`. Workshop
rechecks admission on observation and callback calls; disabling the hook stops delivery.
Replies wake the analyst only after the participant sends them. Deadlines wake it once per
question/interview baseline/deadline, and closed or superseded work is dropped.

Delivery is at-least-once, with stable event IDs, up to eight attempts and capped exponential
backoff. The analyst must deduplicate event IDs and read current context before acting.
Exhausted failures remain in `getContext().investigation.failed`; a recorded callback means it was
queued to the chat, not that model inference or outreach completed. `watch` authorises bounded
wakeups, not arbitrary outreach: email and external writes still use their connectors' approvals.
No email transport or automated Clef contradiction judge is installed by this change.
Re-enabling supplies a fresh resumed event so the analyst can review backlog and failed deliveries;
it does not automatically retry exhausted events. Testimony is retained, not silently pruned.

Steps the agent adds without coordinates are placed in flow order after their predecessors, so a
draft reads left to right without tidying.

## Projects from the retired ten-stage model

A project stored by that model is read once on first open: its map and its accepted current-state
decisions carry across, and nothing else does. That import is one function in
[src/project-do.ts](src/project-do.ts), to delete once no deployment holds such projects.
The new knowledge schema starts empty; it does not silently reinterpret retired records.

## Running the tests

```
pnpm --filter @gadgets/gatekeeper-process test:run
```
