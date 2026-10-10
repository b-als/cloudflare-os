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
10. **Cloudflare-native, and current.** Every capability is built from Cloudflare OS and the
    Cloudflare developer platform, never a third-party service where Cloudflare has the
    primitive. Before designing anything new, check the
    [Cloudflare changelog](https://developers.cloudflare.com/changelog/) for a primitive that already
    does it. The product should be the best showcase of what Cloudflare shipped this quarter (see
    "The Cloudflare stack" below).
11. **Deletion is progress.** A change that replaces a screen deletes it in the same change.
12. **Simplify the interface, not the analysis.** Stakeholders, responsibilities, outcomes,
    evidence, assumptions, risks, trade-offs and commitments are durable, connected project
    knowledge. Chat is how people work with it; it is not its only storage. Documents are generated
    from that knowledge, not independently maintained copies. Unknown ownership stays unknown.
13. **The analyst follows through.** Outstanding work survives browser closure. Replies and
    deadlines wake the existing conversation through explicitly enabled Workshop hooks. The agent
    investigates conflicting accounts before proposing a synthesis; it does not give people
    competing full-map branches to manage. Silence is never consent, and an assigned interview
    name is not proof of identity. Outreach requires scoped authority and its own approvals.

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

## Design review before plumbing

The product owner has approved a standalone, local-only UI prototype for reviewing how process
context sits inside Session. This is a design experiment, not an additional product surface.
It may use clearly labelled sample records and a sample conversation. It must not import the
Workshop bootstrap, authenticate, call an agent, connect to project RPC, or write project state.
Its separate HTML entry is served by Vite in development only and is not a production build input.
Do not link it from product navigation or use its fixtures as a production fallback.

The experiment is one connected workspace: the conversation, the map at full height in the centre,
and one context panel on the right. The panel follows focus. With nothing selected it shows the
whole process (goal, everything open, people, settled decisions); selecting a step on the map, or
a step link in the conversation or a record, narrows it to that step. The three are cross-linked:
map steps show their count of open items, conversation cards link to the steps and records they
concern and highlight while their step is in focus, and records link back to every step they touch.
There are no tabs, search, nested drawers or second chat. Local changes and downloads must be
labelled as samples. UI sign-off comes before backend, role or outreach implementation; approving
the prototype experiment is not approval to ship a management surface.

Within this prototype, double-clicking a map block (or choosing Edit on a focused step) turns the
right-hand panel into the step inspector, leaving the conversation and map in place on desktop.
On smaller screens the context panel sits below the map and the inspector is a right-aligned sheet
with modal focus management. The form scrolls independently with its actions always visible.
Changes require an explicit local Save; Cancel discards them, and closing or switching away from a
dirty editor requires confirmation. Person assignment and team membership are sample presentation
state only.

Open items are grouped under the issue they belong to; agreed decisions stay in a collapsed Settled
list. Supporting evidence opens inline with its claim. An empty step says nothing is open, not that
it is signed off.
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

1. **Decision memory** — the agent never re-litigates settled points. Before a proposal reaches
   the person, the gatekeeper asks Clef whether it contradicts an active decision, and the card
   says so, with the probability.
2. **Walkthrough validation** — "walk me through this as a new customer" plays the process step by
   step on the map.
3. **The agent interviews stakeholders** — separate async interviews, then a synthesis with any
   contradictions flagged to the owner. Clef checks answers against each other for conflicts, and
   routes each parked question to the person best placed to answer it.
4. **Evidence-grounded mapping** — the current state is checked against real tickets, emails, logs,
   screenshots, call recordings and screen recordings, not only against opinion. Clef-omni reads
   images, audio and video directly: which step does this clip show, and is there a hand-off the
   map is missing?
5. **The map becomes running software** — sign-off compiles the approved process into a
   Cloudflare Workflow. Every decision diamond becomes a Clef question whose options are its
   branches, answered in milliseconds with a probability. A low-confidence answer becomes a human
   approval rather than a guess. Each decision is recorded, so monitoring compares what the process
   actually decided against the outcomes it was meant to deliver.

## The Cloudflare stack

Each capability uses the Cloudflare primitive made for it. Add one only for a concrete requirement.

| Need | Cloudflare primitive |
|---|---|
| Projects, live collaboration, decision log | Durable Objects (SQLite), one per project, behind a Cloudflare OS gatekeeper |
| The conversation and its agent | The Cloudflare OS Workshop agent, with its approval queue for every write |
| Persistent investigation and question deadlines | Project Durable Object alarm and outbox, delivering through an enabled Cloudflare OS hook to the existing chat |
| Fast, typed judgements (contradiction, scope drift, routing, gateway decisions) | [Clef](https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/) decision models on Workers AI: `clef-flash` on the hot path, `clef` for precision, `clef-omni` for images, audio and video |
| Model calls observed and controlled | AI Gateway, as Cloudflare OS already configures it |
| Stakeholder invites and replies by email | Email Service and Email Workers |
| Evidence from systems' screens | Browser Run |
| Running the approved process | Workflows, with human steps as waits for an approval |
| Measuring outcomes after go-live | Workers Analytics Engine |

Clef assesses the questions a business analyst asks constantly: yes or no, which of these, how
strongly. It provides a typed assessment, not truth, verified identity or decision authority.
Accepted changes remain the person's decision. Verify model availability and input schemas before
shipping a multimodal integration; the stack table is direction, not a claim that every variant is
installed.

## Implemented investigation foundation

The core conversation-to-approved-map loop is implemented. The next foundation preserves analytical
depth in structured records, produces documents from accepted state, and supports independent
question-only interviews. Stakeholder replies retain provenance and baseline revision and do not
alter the agreed map. Synthesis is a separate proposal.

An enabled investigation hook can wake the same conversation on a reply or deadline after the
browser closes. It does not automatically send emails, prove who supplied a reply, infer agreement
from a missed deadline, or claim that a queued wakeup completed an agent turn. Clef-assisted
contradiction detection and authorised email transport remain separate integrations.

## Out of scope (until this charter says otherwise)

- New stages, tabs or pages per artifact or per method.
- Configuration or settings screens for BA Studio.
- A separate BA identity, collaboration, chat or agent system.
- Interview, evidence or execution features before the core loop works.

## Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-10-10 | Adopt this chat-first charter; retire the ten-stage UI | The first version became too complex for the intended guided experience |
| 2026-10-10 | Cloudflare-native principle; Clef decision models for typed judgements | Decisions a BA makes (contradiction, routing, gateway outcomes) are typed and need calibrated confidence, which is what Clef returns; it also makes the product a showcase of Cloudflare's newest primitives |
| 2026-10-10 | Preserve analytical depth behind chat and advance durable investigation; implement the already-approved third interview surface | The user clarified that simplification must retain stakeholders, responsibilities, outcomes, risks and trade-offs, and requested a persistent analyst rather than a manual mapping tool. No fourth surface or new header controls are added |
| 2026-10-10 | Review an isolated mock-data Process brief prototype before plumbing | The user explicitly requested a clickable UI with sample data to sign off on the experience before spending on agent calls or backend work. The exception is development-only, makes no project writes or model calls, and does not increase production surface budgets |
| 2026-10-10 | Add manually editable block properties to the design prototype | The user requested double-click access to properties including assigned person and team. The editor replaces the brief in the existing work area; production map behaviour and backend contracts remain unchanged |
| 2026-10-10 | Move the prototype properties to a right-edge contextual inspector | The user explicitly requested properties always open on the right. Preserve the conversation, map and brief on desktop; use a right-aligned sheet on smaller screens with accessible dismissal and protected drafts. This revises the earlier placement only, not production surface budgets |
| 2026-10-10 | Try Overview, People and Review inside the mock Process brief | The user approved the proposed three-view iteration to reduce clutter. These are local views, not stage navigation: concise orientation, compact ownership, and issue-grouped review with inline evidence and collapsed decision history. Production budgets and the no-plumbing checkpoint remain unchanged |
| 2026-10-10 | Replace the brief views with one connected workspace | The user found the tabbed brief disconnected from the map and conversation. The map becomes central, a single right-hand context panel follows focus, and map, conversation and records are cross-linked. Overview/People/Review tabs and search are withdrawn. Prototype only; production budgets and the no-plumbing checkpoint remain unchanged |
