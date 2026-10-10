# BA Studio product charter

This is the source of truth for what BA Studio is and is not. Read it before changing anything
in BA Studio (BA Projects, `packages/workshop-frontend/src/ba-studio`, `packages/gatekeeper-process`).
If a request conflicts with this charter, say so and propose the conversational alternative — do
not quietly build around it. The charter changes deliberately, through the decision log at the
bottom, never by drift.

The migration from the current build to this charter is [plans/ba-chat-first.md](../plans/ba-chat-first.md).

## The idea in one sentence

An AI business analyst that people talk to: it interviews them, draws the process live in front
of them, and turns the agreed design into something that runs.

## Why this charter exists

The first version became a methodology-shaped application: ten stage tabs named after BA
frameworks, three separate chat surfaces (one of them scripted), header badges, drawers, and a
canvas that had to be driven by hand with on-screen instructions. To find their way around, a
user had to already know business analysis — which defeats the purpose of an AI analyst. The
screens mirrored the data model (one tab per artifact type) instead of the person's journey.

## The experience

Three surfaces. No more.

1. **Start** — one question, *"What process do you want to map or improve?"*, plus recent
   processes. Answering it creates the project and starts the conversation.
2. **Session** — the conversation and the live process map, side by side. The header holds the
   process name, the phase indicator, **Invite** and **Docs**. Nothing else.
3. **Stakeholder interview** — a chat-only view reached from an invite link, with no platform
   navigation. Answers flow into the owner's session.

The agent leads through four phases. They are a progress indicator, never navigation:

| Phase | What the agent establishes | Absorbs the old stages |
|---|---|---|
| **Understand** | The problem, measurable outcomes, who is involved | Outcomes, Stakeholders |
| **Map** | How the process runs today and where it hurts | Current state |
| **Improve** | Target process, requirements, trade-offs, walkthrough validation | Requirements, Future state, Trade-offs, Validate |
| **Ship** | Sign-off, hand-off, later monitoring | Sign-off, Hand-off, Monitor |

## Principles

1. **Conversation is the spine.** Every capability is reachable by asking the agent. Nothing
   ships as UI-only.
2. **The agent leads.** It knows what is missing and asks for it. The person is guided and never
   has to find their way around.
3. **The method is the agent's job.** BABOK, SIPOC, RACI, MoSCoW, BPMN, DMN, SMART and the like
   live in the agent's reasoning and in generated documents. They never appear as navigation,
   labels, or required input.
4. **The map is the one living artifact.** It is always visible, editable by talking or by direct
   manipulation, and agent changes show as previews the person accepts or rejects.
5. **Decisions appear inline.** When the agent needs a decision, a card appears in the
   conversation. There are no forms on separate screens.
6. **Documents on request.** RACI, SIPOC, BPMN XML, user stories and decks are produced when asked
   for, from the Docs menu or the conversation. No document gets its own screen or editor.
7. **Decisions are memory.** Accepted decisions are recorded and cited. The agent does not reopen a
   decided point without new evidence, and says so when it does.
8. **Real or nothing.** No scripted agents, demo data or "in the live version…" placeholders on a
   product path. Fixtures belong in tests.
9. **Reuse the platform.** Cloudflare OS workspaces provide isolation, sharing provides
   collaborators, the Workshop agent provides chat, and gatekeepers/MCP provide external data. BA
   Studio builds no parallel identity, collaboration, chat or agent system.
10. **Deletion is progress.** A change that replaces a screen deletes it in the same change.

## Interaction vocabulary

Chat messages, plus exactly three card kinds:

- **propose** — a change to the map or a project record. Accept, Edit or Reject.
- **ask** — a question for the person, or for a named stakeholder (which becomes an invite).
- **flag** — a gap, risk or conflict, such as *"Finance says 2 days, Ops says 9"*.

Map previews show proposed changes highlighted until they are accepted. Selecting a step on the
map scopes the conversation to that step.

## Hard budgets

| Budget | Limit |
|---|---|
| Surfaces (routes a person can land on) | 3 — Start, Session, Stakeholder interview |
| Session header controls | 4 — name, phase indicator, Invite, Docs |
| Chat card kinds | 3 — propose, ask, flag |
| Agent / chat surfaces per session | 1 |
| BA entries in the platform sidebar | 1 |
| Screens per artifact or per method | 0 |
| On-screen text explaining gestures | 0 — if the UI needs instructions, redesign it or let the agent explain |

Exceeding a budget requires a decision-log entry approved by the product owner **before** the work
starts.

## The decision test

Answer these before adding or changing anything:

1. Can the agent do this in the conversation instead? If so, do it there.
2. Does it add a route, tab, page, panel, drawer, modal, sidebar item or header control? If so,
   stop — it exceeds a budget.
3. Would a stakeholder who has never seen the product understand it with no help text?
4. Which phase does it serve, and which differentiator below? If neither, it is out of scope.
5. Does it let something be deleted? Prefer the version that removes code.

## What makes it different

This is where the roadmap leads, in order. Nothing here starts before the core loop
(conversation → map preview → accept) works end-to-end with the real agent.

1. **Decision memory** — the agent never re-litigates settled points.
2. **Walkthrough validation** — "walk me through this as a new customer" plays the process step by
   step on the map.
3. **The agent interviews stakeholders** — separate async interviews, then a synthesis with any
   contradictions flagged to the owner.
4. **Evidence-grounded mapping** — the current state is checked against real tickets, emails and
   logs through scoped gatekeepers, not only against opinion.
5. **The map becomes running software** — sign-off produces a working workflow or gadget on
   Cloudflare. Monitoring then uses real telemetry.

## Out of scope (until this charter says otherwise)

- New stages, tabs or pages per artifact or per method.
- Configuration or settings screens for BA Studio.
- A separate BA identity, collaboration, chat or agent system.
- Interview, evidence or execution features before the core loop works.

## Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-10-10 | Adopt this chat-first charter; retire the ten-stage UI | The first version became too complex for the intended guided experience |
