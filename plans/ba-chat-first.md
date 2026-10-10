# Plan: BA Studio, chat-first

## Goal

Turn BA Studio from a ten-stage, methodology-shaped application into the product described in
[docs/ba-studio-charter.md](../docs/ba-studio-charter.md): one conversation with an AI business
analyst, beside one live process map, with the agent leading the person through four phases
(Understand → Map → Improve → Ship). Then layer on the differentiators in order: decision memory,
walkthrough validation, stakeholder interviews, evidence-grounded mapping, and maps that become
running software.

Each phase ends in a working product, deletes more than it adds where possible, and has exit
criteria that can be checked. Do not start a phase until the previous one meets its exit criteria.

## Branch strategy

The rebuild happens on **`ba-chat-first`**, branched fresh from `upstream/main` rather than from
`custom`. The ten-stage UI is not carried over, so there is nothing to freeze or delete, and the
branch's diff against upstream *is* the product. Only the parts worth keeping were transplanted:

| Carried over | Why |
|---|---|
| `packages/gatekeeper-process` | The backend: one SQLite Durable Object per project, graph operations, lifecycle records, coverage, approval-queue proposals with simulation, owner-only baseline review, plus (from PRs #5–#7) a stakeholder register, an interview plan, elicitation hardening for messy answers ([ELICITATION.md](../packages/gatekeeper-process/ELICITATION.md)) and persisted takeaways. 84 tests. |
| `Gatekeeper.startUi` / `GatekeeperClient.openUi` (`workshop-shared`, `overseer.ts`) | Lets a person edit the map directly, outside the approval queue. ≈30 kernel lines. |
| Dev tooling (`run-dev-server.ts` extra gatekeeper folders and sharing domain, `pnpm dev:local`, the release manifest entry) | Runs and ships the process gatekeeper. |
| Charter, this plan, agent instructions | Guardrails. |

`custom` is frozen. Its final state is tagged **`ba-ten-stage-archive`**. Never merge it in. Copy
an individual file across (`git show ba-ten-stage-archive:<path>`) only when the port list below
calls for it, and rewrite it to the charter as it lands.

### Port list (from `ba-ten-stage-archive`, when the phase needs it)

| Phase | Files | Notes |
|---|---|---|
| 1 | `ba-studio/ProcessCanvas.tsx`, `opQueue.ts` (+ test), `processWorkspace.ts`, `useProcessStudio.ts`, `useWorkspacePeople.ts`, `PersonField.tsx`, `StepDetailsPanel.tsx` | Swap any `prototype.ts` types for `@gadgets/gatekeeper-process` types. Remove the canvas help text. |
| 1 | `ChatComposer` `autoSend`, and the `ChatInterface` `seedText`, `seedNonce`, `autoSend` and `newChatBlockedReason` props (+ test) | The Start prompt becomes the first message. |
| 1 | Sidebar "BA Projects" entry; `@xyflow/react` and `@gadgets/gatekeeper-process` dependencies in `workshop-frontend/package.json` | One sidebar entry. |
| 2 | `ba-studio/exports.ts` | Rewrite against live project data for the Docs menu. |

Never ported: `stages/*`, `stages.tsx`, `LifecyclePanel`, `CoverageBadge`, `DecisionsDrawer`,
`TraceabilityDrawer`, `AgentPanel`, `agentScripts`, `demoProject`, `prototype.ts`, `liveProject`,
the `$stage` route, `/workflow-studio`, and the "AI agent" entry in `GatekeeperAppPage`.

## Where we started (`custom`, 2026-10-10)

| Measure | `custom` | Charter budget |
|---|---|---|
| BA routes a person can land on | 4 (`/ba-projects`, `/ba-projects/$id`, `/ba-projects/$id/$stage`, `/workflow-studio`) | 3 |
| Stage tabs in a project | 10 | 0 (4-phase indicator) |
| Chat/agent surfaces | 3 (workspace chat panel that can sit on "No agent", the scripted `AgentPanel`, per-stage "Ask me about this"), plus a separate chat inside `/workflow-studio` | 1 |
| BA entries in the platform sidebar | 2 ("BA Projects", plus the "Process Studio" gatekeeper app) | 1 |
| Session header controls | Live, Saved/rev, Coverage, Decisions, Share | 4 |
| Frontend BA code | ≈6.9k lines in `src/ba-studio` (+ ≈650 in `routes/workflow-studio.tsx`) | — |

## Phase 0 — Guardrails and a clean branch

- [x] Charter: [docs/ba-studio-charter.md](../docs/ba-studio-charter.md).
- [x] Always-on agent rules in the root [AGENTS.md](../AGENTS.md), and file-scoped rules in
  [.github/instructions/ba-studio.instructions.md](../.github/instructions/ba-studio.instructions.md).
- [x] Uncommitted work on `custom` committed. The gatekeeper changes (map changes wait for a
  decision, complete change descriptions, stricter record validation) were carried over; the
  ten-stage UI edits stay in the archive.
- [x] `ba-chat-first` branched from `upstream/main`, with the keepers above transplanted.

**Exit:** the branch type-checks, the process gatekeeper's tests and the release manifest test
pass, and `pnpm configs:check` is clean.

## Phase 1 — The core loop

One screen where talking produces a map. This is the phase that changes how the product feels;
nothing else matters until it works. Port what it needs from the list above.

- **Start** (`routes/ba-projects.index.tsx`): one prompt, "What process do you want to map or
  improve?", plus recent processes as a short list. Submitting creates the workspace and project
  (`processWorkspace.ts`) and sends the answer as the first message.
- **Session** (`routes/ba-projects.$workspaceId.tsx`): two panes, the conversation and the live
  map. The header holds the name, the phase indicator (static for now), Invite (the existing
  `ShareModal`) and Docs (stubbed).
- **One agent, always on.** The BA agent is preselected for BA workspaces; the "No agent" state is
  unreachable. Its opening question is written for the Understand phase, not for a stage.
- **Agent edits become cards.** Process edits the agent queues through the gatekeeper's approval
  queue render as **propose** cards in the conversation (Accept, Edit, Reject) and as highlighted
  previews on the map. The gatekeeper already sets `awaitDecision`, so the agent waits for the
  answer. Reuse the Workshop's existing approval surface rather than building a new one. Questions
  render as **ask** cards and gaps as **flag** cards.
- **Map ↔ chat.** Selecting a step adds an "About: step name" reference to the composer. Direct
  manipulation (drag, connect, rename) goes through `openUi`, with no on-screen gesture help.
- **Budget ratchet test** (`ba-studio/surfaceBudget.test.ts`), added with the first route. It
  fails when there are more than two `routes/ba-projects*` files, or when method names
  (`SIPOC|RACI|MoSCoW|BABOK|BPMN|DMN|SMART`) appear in UI string literals. Phase 4 raises the
  route limit to three for the interview surface, and nothing else ever raises it.

**Exit:**

- Starting from a blank Start screen, a person maps a 6–8 step as-is process **only by chatting**
  in under 10 minutes, with no clicks outside the conversation and the map.
- An end-to-end test (integration-tests or workshop-evals) covers: prompt → agent proposal → map
  preview → accept → persisted graph.
- The ratchet test passes.

## Phase 2 — Phases and documents

Bring the rest of the lifecycle into the conversation as four agent-led phases.

- **Phases are derived, not navigated.** Compute Understand, Map, Improve and Ship from project
  state; [coverage.ts](../packages/gatekeeper-process/src/coverage.ts) becomes the agent's
  checklist of what to ask next. The agent's instructions name the current phase and its gaps. The
  phase indicator shows progress, and asking ("let's look at the future state") is how a person
  jumps.
- **Records, no screens.** Outcomes, stakeholders, requirements, trade-offs and scenarios remain
  gatekeeper data that the agent writes through proposals. No screen edits them directly.
- **Docs menu.** Generate RACI, SIPOC, BPMN XML, user stories and a summary on demand (port and
  rewrite `exports.ts`).
- Update the [gatekeeper-process README](../packages/gatekeeper-process/README.md) to describe
  phases rather than stages.

**Exit:**

- Every lifecycle record type can be created and changed entirely from the conversation.
- BA frontend code stays under 3.5k lines (`custom` was ≈7.5k).
- 2 BA routes, one agent surface, one sidebar entry, no method names in UI copy.

## Clef in the gatekeeper

[Clef](https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/) is Cloudflare's
decision model family on Workers AI: send a `state` and up to 64 typed `questions` (`noul` for
yes/no, `choice` for one of a set, `score` against a rubric) and get calibrated probabilities back,
with no prose to parse. `@cf/cloudflare/clef-flash` answers in tens of milliseconds for the hot path,
`@cf/cloudflare/clef` is the precise one, and `@cf/cloudflare/clef-omni` also reads images, audio and
video. The agent talks and writes; Clef decides.

It lives in the **process gatekeeper**, not the kernel: one Workers AI binding on
`gatekeeper-process` (upstream already binds Workers AI in the backend for `toMarkdown`, so this is
an established pattern) and one module, `src/judge.ts`, that owns every question the product asks.
Rules for that module:

- Every question has a typed result and a threshold, and a test with a recorded response.
- Batch the questions for one decision into one call, since a single request takes up to 64.
- Its output is advice, never authority. A Clef flag changes what a card says or who gets asked;
  the person's Accept still decides what is written.
- With no binding (local dev without an account, tests), judgements are skipped, not faked.

Phase 3 introduces the module, and every later phase adds its questions to it.

## Phase 3 — Decision memory and sign-off in the conversation

- Accepted proposals and explicit decisions are recorded as decisions and included in the agent's
  context. The agent cites them, and won't reopen one without naming the new evidence.
- "Ready to sign off?" arrives as a **propose** card when the gatekeeper's approval requirements
  hold. Approval still goes through the existing owner-only review capability (authority is
  unchanged; only the surface moves into chat).
- **Walkthrough validation**: "walk me through this as …" steps through a path, highlighting nodes
  on the map, and records the walk as a validation scenario.
- **Clef guardrail on proposals.** Before `applyChanges` queues a proposal, `judge.ts` asks
  `clef-flash` one `noul` per active decision the change touches or neighbours: "Does this change
  contradict this decision?". Above the threshold, the proposal card names the decision and the
  probability, and the agent is told why. This is decision memory enforced at write time, not left
  to the prompt.

**Exit:** a workshop-evals suite shows the agent does not contradict locked decisions across
scripted multi-session conversations, that sign-off is reachable entirely from chat, and that the
guardrail flags seeded contradictions without flagging consistent changes.

## Phase 4 — Many voices

- An **ask** card addressed to a named stakeholder becomes an invite. The invite link opens the
  **Stakeholder interview** surface (the third and final surface): chat-only, no platform chrome,
  built on the existing sharing capability.
- The agent interviews each person separately, combines the answers, and raises contradictions as
  **flag** cards for the owner. Clef does the comparing: a `noul` per answer pair on the same step
  ("Do these two accounts of this step contradict each other?"), so contradictions are found
  systematically rather than when the agent happens to notice.
- Parked questions route themselves: a Clef `choice` over the stakeholder register picks who is
  best placed to answer, which the register work from PRs #5–#7 can act on directly.
- Deliver invites and take replies by email with Email Service and Email Workers, so a stakeholder
  can answer without opening the app at all.

**Exit:** three stakeholders interviewed asynchronously on one process, with conflicts surfaced and
resolved in the owner's session.

## Phase 5 — Evidence-grounded mapping

- Connect sources through existing gatekeepers and MCP endpoints with deliberately scoped
  permissions (tickets, mail threads, database or Worker logs).
- The agent compares the map against the evidence and flags differences ("the map has 3 hand-offs;
  the email trail shows 7"), with the evidence attached to the step.
- **Show, don't describe.** A person can drop in a screenshot, a whiteboard photo, a call
  recording or a screen recording of themselves doing the work. `clef-omni` reads it directly, with
  no transcription step: a `choice` over the map's steps ("Which step does this show?") and a
  `noul` ("Is there a hand-off here that the map doesn't have?"). The agent turns what it finds into
  proposals. Browser Run captures system screens the same way.

**Exit:** one real connector produces evidence-backed annotations on a map.

## Phase 6 — The map becomes running software

- Sign-off offers "Build it": the approved target process compiles into a **Cloudflare Workflow**.
  Tasks become steps; a human task becomes a wait for that person's approval.
- **Gateways become Clef questions.** Each exclusive gateway is a Clef `choice` whose options are
  its outgoing branch labels, asked of the case in flight (`clef-flash` by default, `clef-omni` when
  the case carries documents or images). Below the gateway's confidence threshold, the Workflow
  routes the case to a person instead of guessing. The decision diamonds the stakeholders agreed on
  are literally the logic that runs.
- Every gateway decision, with its probability and branch, and every step's timing go to Workers
  Analytics Engine. Monitoring compares that real behaviour against the outcomes the project set
  out to move, and replaces the old Monitor placeholder.

**Exit:** a simple approved process with at least one gateway runs as a Workflow on Cloudflare,
routes a low-confidence case to a person, and reports measured outcomes back into its project.

## How work is run

- Every BA change states which phase it belongs to and passes the charter's decision test.
- Kernel discipline still applies: keep `workshop-backend` and `workshop-shared` changes small, and
  put BA logic in `gatekeeper-process` and the frontend (see the root AGENTS.md).
- Changing a budget, the surfaces or the card vocabulary requires a decision-log entry in the
  charter, approved before the work starts.

## Open decisions

1. **Route names**: keep `/ba-projects` and `/ba-projects/$id`, or rename them (e.g. `/process`)
   once the stage route is gone. Default: keep them, to avoid churn.
2. **Process Studio gatekeeper UI** (`providesUi`): drop it, or keep it as an admin-only view of
   projects. Default: remove it from the sidebar in Phase 1, decide in Phase 2.
3. **Which agent model and instructions** the BA agent uses by default, and whether the
   deployment admin can change it.
4. **One stakeholder model.** The gatekeeper now has two: the lifecycle's `stakeholder` artifact
   (role, influence, interest, stance) and the register from PRs #5–#7 (name, role, stance, linked
   user, interview target). Merge them into the register in Phase 2, before anything renders
   stakeholders, so the agent has one place to write them.
