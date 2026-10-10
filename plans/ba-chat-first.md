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
branch's diff against upstream *is* the product.

| Kept | Why |
|---|---|
| `packages/gatekeeper-process`, **rebuilt lean** | The backend: one SQLite Durable Object per project holding the graph, the decision log and a change log; graph operations with flow placement; coverage; approval-queue proposals with ghost previews. The agent contract is two calls, `getContext()` and `applyChanges()`. |
| `Gatekeeper.startUi` / `GatekeeperClient.openUi` (`workshop-shared`, `overseer.ts`) | Lets a person edit the map directly, outside the approval queue. ≈30 kernel lines. |
| Dev tooling (`run-dev-server.ts` extra gatekeeper folders and sharing domain, `pnpm dev:local`, the release manifest entry) | Runs and ships the process gatekeeper. |
| Charter, this plan, agent instructions | Guardrails. |

`custom` is frozen. Its final state is tagged **`ba-ten-stage-archive`**. Never merge it in, and
don't port from it: each phase builds what it needs, written for the conversation from the start.

### Deleted in the lean rebuild

The first transplant carried the whole `custom` gatekeeper, including PRs #5–#7. Rather than build
the new product on top of the old one's data model, the gatekeeper was rebuilt around the loop the
charter describes, and these were deleted outright:

- The **ten-stage lifecycle records** (outcomes, stakeholders, requirements, trade-offs,
  scenarios) and their validation. Each was a screen's data model, not something the conversation
  needed.
- The **stakeholder register**, **interview plan**, **parked questions** and **takeaways** from
  PRs #5–#7. Phase 4 rebuilds the few that "many voices" needs, shaped by the interview surface.
- **Step locks** and the **owner-only baseline review**. Phase 3 brings sign-off back as a card in
  the conversation.
- The **Process Studio management UI** (`providesUi`), its React app and `ELICITATION.md`.

Projects created on `custom` still open: the project Durable Object imports their lanes, steps,
flows and as-is decisions on first read (`#importRetiredModel`, to be removed once they've been
opened).

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
- [x] Gatekeeper rebuilt lean (see above); `types.txt` is a real copy of `types.d.ts`, kept equal by
  `scripts/gatekeeper-types.test.ts` (upstream's symlink checks out as a plain file on Windows).

**Exit:** the branch type-checks, the process gatekeeper's tests and the release manifest test
pass, and `pnpm configs:check` is clean.

## Phase 1 — The core loop

One screen where talking produces a map. This is the phase that changes how the product feels;
nothing else matters until it works.

Status: built (Start, Session, ghost previews, phase strip, ratchet test). Waiting on the
end-to-end run with a working model, and on the end-to-end test.

- [x] **Start** (`routes/ba-projects.index.tsx`): one prompt, "What process do you want to map or
  improve?", three starters, and recent processes as a short list. Submitting creates the
  workspace and project (`processWorkspace.ts`), names it after the first clause of the answer,
  and the session sends the answer as the first message.
- [x] **Session** (`routes/ba-projects.$workspaceId.tsx`): two panes, the conversation and the live
  map. The header holds the name, the phase indicator and Invite (the existing `ShareModal`).
  There is no Docs control: Phase 2 decides whether documents are a header control or something
  the person asks for.
- [x] **One agent, always on.** "No agent" is hidden, and nothing is sent until a model is
  selected. The agent's contract tells it to draft a first map straight away from the opening,
  marking what it inferred, then ask one question.
- [x] **Agent edits become cards.** `applyChanges` queues one proposal through the approval queue.
  It renders as the Workshop's existing action card in the conversation and as ghost lanes, steps
  and flows on the map until it is decided. The composer is blocked while it waits, so the person
  answers it before moving on.
- [x] **Map ↔ chat.** Selecting a step puts "About “step”: " in the composer. Rename, move, connect
  and Tidy go through `openUi`, with no on-screen gesture help.
- [x] **Budget ratchet test** (`ba-studio/surfaceBudget.test.ts`). It fails when there are more
  than two `routes/ba-projects*` files, or when method names
  (`SIPOC|RACI|MoSCoW|BABOK|BPMN|DMN|SMART`) appear in UI string literals. Phase 4 raises the
  route limit to three for the interview surface, and nothing else ever raises it.
- [ ] End-to-end run with a working model, then the end-to-end test below.

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
- **Records only when the conversation needs them.** Add a record type (outcomes, requirements,
  trade-offs…) only when the agent has something to do with it in a phase, write it through
  `applyChanges`, and never give it a screen. The decision log is the only record today.
- **Documents on request.** The person asks for a document ("send me the RACI") and the agent
  produces it from live project data. Whether a Docs header control is also needed is decided
  here, against the four-control budget.
- Update the [gatekeeper-process README](../packages/gatekeeper-process/README.md) to describe
  phases rather than stages.

**Exit:**

- Every record type that exists can be created and changed entirely from the conversation.
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

- **Investigation foundation implemented ahead of the remaining milestones:** connected knowledge
  records for stakeholders, outcomes, responsibilities, risks, evidence, trade-offs and questions;
  atomic map/knowledge proposals; accepted-state Markdown documents; and a durable reply/deadline
  outbox delivering to the existing chat through a user-enabled Workshop hook. This restores the
  analytical depth, not the retired register or lifecycle implementation.
- Accepted proposals and explicit decisions are recorded as decisions and included in the agent's
  context. The agent cites them, and won't reopen one without naming the new evidence.
- "Ready to sign off?" arrives as a **propose** card when the gatekeeper's approval requirements
  hold. Sign-off needs a deliberately scoped decision capability; the retired owner-only review
  implementation was deleted and must not be assumed to exist.
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

- **Question-only interview slice implemented:** an accepted question grants a revocable resource
  capability; the charter's third route opens a separate Workshop conversation with that capability,
  never the agreed map. Submitted testimony is immutable and attributed to the assigned interview,
  not a verified identity. Answers wake the owner's existing conversation only after approval.
  Invitation navigation tests and project eviction tests cover recovery; duplicate reply IDs do not publish twice.
  Synthesis still uses the existing approval queue. No automated conflict verdict is inferred from
  agent prose, and no email transport is installed by this slice.
  The interview skips unrelated Workshop onboarding and billing setup, without bypassing sign-in
  or capability checks. Live local checks exercise accepted-state documents, isolated invitations,
  approved testimony and delivery to the original agent chat.
- An **ask** card addressed to a named stakeholder becomes an invite. The invite link opens the
  **Stakeholder interview** surface (the third and final surface): chat-only, no platform chrome,
  built on the existing sharing capability.
- The agent interviews each person separately, combines the answers, and raises contradictions as
  **flag** cards for the owner. Clef does the comparing: a `noul` per answer pair on the same step
  ("Do these two accounts of this step contradict each other?"), so contradictions are found
  systematically rather than when the agent happens to notice.
- Parked questions route themselves: a Clef `choice` over the project's stakeholders picks who is
  best placed to answer. Phase 4 adds the small stakeholder record this needs (name, role, linked
  user), shaped by the interview surface rather than restored from `custom`.
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
2. **Process Studio gatekeeper UI** (`providesUi`): decided, removed in the lean rebuild. Accounts
   provisioned before then still carry it in the Workshop's stored account description, which is
   never refreshed; clear it from local dev state rather than adding a kernel refresh.
3. **Which agent model and instructions** the BA agent uses by default, and whether the
   deployment admin can change it. Leaning to Workers AI through AI Gateway, so a fresh deployment
   maps processes with no third-party key.
4. **Stakeholders**: decided, deleted with the register; Phase 4 adds back the minimum it needs.
