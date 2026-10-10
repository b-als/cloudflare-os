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

## Where we are (2026-10-10)

| Measure | Today | Charter budget |
|---|---|---|
| BA routes a person can land on | 4 (`/ba-projects`, `/ba-projects/$id`, `/ba-projects/$id/$stage`, `/workflow-studio`) | 3 |
| Stage tabs in a project | 10 | 0 (4-phase indicator) |
| Chat/agent surfaces | 3 (workspace chat panel that can sit on "No agent", the scripted `AgentPanel`, per-stage "Ask me about this"), plus a separate chat inside `/workflow-studio` | 1 |
| BA entries in the platform sidebar | 2 ("BA Projects", plus the "Process Studio" gatekeeper app) | 1 |
| Session header controls | Live, Saved/rev, Coverage, Decisions, Share | 4 |
| Frontend BA code | ≈6.9k lines in `src/ba-studio` (+ ≈650 in `routes/workflow-studio.tsx`) | — |
| Process gatekeeper | ≈3.1k lines in `packages/gatekeeper-process/src` | — |

What already exists and is worth keeping:

- [`routes/ba-projects.$workspaceId.tsx`](../packages/workshop-frontend/src/routes/ba-projects.$workspaceId.tsx)
  already composes the real `ChatInterface` with `ProcessCanvas`. The core loop is present, just
  buried under the tabs, badges and drawers.
- The process gatekeeper: one SQLite Durable Object per project
  ([project-do.ts](../packages/gatekeeper-process/src/project-do.ts)), graph operations
  ([graph-ops.ts](../packages/gatekeeper-process/src/graph-ops.ts)), lifecycle records
  ([lifecycle.ts](../packages/gatekeeper-process/src/lifecycle.ts)), coverage checks, the approval
  queue with simulation, and the owner-only baseline review capability.
- [opQueue.ts](../packages/workshop-frontend/src/ba-studio/opQueue.ts), the pending-proposal map
  preview, [interview.ts](../packages/workshop-frontend/src/ba-studio/interview.ts) (agent opening
  prompts) and [exports.ts](../packages/workshop-frontend/src/ba-studio/exports.ts) (document
  generation).

What is dead or scaffolding:

- [AgentPanel.tsx](../packages/workshop-frontend/src/ba-studio/AgentPanel.tsx) and
  [agentScripts.ts](../packages/workshop-frontend/src/ba-studio/agentScripts.ts) are imported by
  nothing in the product.
- [demoProject.ts](../packages/workshop-frontend/src/ba-studio/demoProject.ts) is used only by
  `exports.test.ts`.
- [prototype.ts](../packages/workshop-frontend/src/ba-studio/prototype.ts) is the type hub for the
  old prototype contract (`workflow-studio-demo/v1.1`) and is still imported widely.

## Phase 0 — Guardrails and freeze

Make derailing hard before building anything.

- [x] Charter: [docs/ba-studio-charter.md](../docs/ba-studio-charter.md).
- [x] Always-on agent rules in the root [AGENTS.md](../AGENTS.md), and file-scoped rules in
  [.github/instructions/ba-studio.instructions.md](../.github/instructions/ba-studio.instructions.md).
- [ ] **Resolve the uncommitted lifecycle work** on `custom`: the stage, lifecycle, `liveProject`
  and `interview` edits. Commit what feeds the core loop (`liveProject`, `interview`, the gatekeeper
  lifecycle changes). Before Phase 2 deletes the ten-stage UI, tag that UI
  (`ba-ten-stage-archive`) so nothing is lost.
- [ ] **Freeze the legacy UI**: no feature work on `stages/*`, `LifecyclePanel`, the drawers,
  `CoverageBadge` or `/workflow-studio`. Fix only bugs that block the core loop.
- [ ] **Delete dead code**: `AgentPanel.tsx` and `agentScripts.ts`. Move `demoProject.ts` beside
  its only test as a fixture.
- [ ] **Budget ratchet test** (`ba-studio/surfaceBudget.test.ts`). It fails when:
  - the number of `routes/ba-projects*` and `routes/workflow-studio*` files grows beyond today's
    count, or
  - method names (`SIPOC|RACI|MoSCoW|BABOK|BPMN|DMN|SMART`) appear in UI string literals outside
    an allowlist of legacy files.

  Each later phase lowers the counts and shrinks the allowlist, so the test only ever gets
  stricter.

**Exit:** guardrails merged, the working tree clean, and the ratchet test green.

## Phase 1 — The core loop

One screen where talking produces a map. This is the phase that changes how the product feels;
nothing else matters until it works.

- **Start** ([`ba-projects.index.tsx`](../packages/workshop-frontend/src/routes/ba-projects.index.tsx)):
  one prompt, "What process do you want to map or improve?", plus recent processes as a short
  list. Submitting creates the workspace and project
  ([processWorkspace.ts](../packages/workshop-frontend/src/ba-studio/processWorkspace.ts)) and
  sends the answer as the first message.
- **Session**: two panes, the conversation and the live map. The header holds the name, the phase
  indicator (static for now), Invite (the existing `ShareModal`) and Docs (stubbed).
- **One agent, always on.** The BA agent is preselected for BA workspaces; the "No agent" state is
  unreachable. The agent's opening comes from `interview.ts`.
- **Agent edits become cards.** Process edits the agent queues through the gatekeeper's approval
  queue render as **propose** cards in the conversation (Accept, Edit, Reject) and as highlighted
  previews on the map. Reuse the Workshop's existing approval surface rather than building a new
  one. Questions render as **ask** cards and gaps as **flag** cards.
- **Map ↔ chat.** Selecting a step adds an "About: step name" reference to the composer. Direct
  manipulation (drag, connect, rename) stays, and the canvas help text is removed.
- Hide the stage tabs, Coverage, Decisions and Traceability from the session; don't delete them
  yet. Remove the "Process Studio" sidebar entry for BA users.

**Exit:**

- Starting from a blank Start screen, a person maps a 6–8 step as-is process **only by chatting**
  in under 10 minutes, with no clicks outside the conversation and the map.
- An end-to-end test (integration-tests or workshop-evals) covers: prompt → agent proposal → map
  preview → accept → persisted graph.
- The ratchet test still passes.

## Phase 2 — Collapse and delete

Replace the ten stages with the four agent-led phases, and remove what they replace.

- **Phases are derived, not navigated.** Compute Understand, Map, Improve and Ship from project
  state; [coverage.ts](../packages/gatekeeper-process/src/coverage.ts) becomes the agent's
  checklist of what to ask next. The agent's instructions name the current phase and its gaps. The
  phase indicator shows progress, and asking ("let's look at the future state") is how a person
  jumps.
- **Records stay; their screens go.** Outcomes, stakeholders, requirements, trade-offs and
  scenarios remain gatekeeper data that the agent writes through proposals. No screen edits them
  directly.
- **Docs menu.** Generate RACI, SIPOC, BPMN XML, user stories and a summary on demand from
  `exports.ts` and live project data.
- **Delete:** `stages/*`, `stages.tsx`, `LifecyclePanel`, `CoverageBadge`, `DecisionsDrawer`
  (decisions move into the conversation and a Decisions doc), `TraceabilityDrawer`, the `$stage`
  route, `/workflow-studio`, and whatever of `prototype.ts` nothing still needs. Update the
  [gatekeeper-process README](../packages/gatekeeper-process/README.md) to describe phases rather
  than stages.

**Exit:**

- 2 BA routes, and no method names in UI copy (ratchet allowlist empty).
- BA frontend code down by at least half (≈6.9k → under 3.5k lines).
- One agent surface, one sidebar entry.

## Phase 3 — Decision memory and sign-off in the conversation

- Accepted proposals and explicit decisions are recorded as decisions and included in the agent's
  context. The agent cites them, and won't reopen one without naming the new evidence.
- "Ready to sign off?" arrives as a **propose** card when the gatekeeper's approval requirements
  hold. Approval still goes through the existing owner-only review capability (authority is
  unchanged; only the surface moves into chat).
- **Walkthrough validation**: "walk me through this as …" steps through a path, highlighting nodes
  on the map, and records the walk as a validation scenario.

**Exit:** a workshop-evals suite shows the agent does not contradict locked decisions across
scripted multi-session conversations, and that sign-off is reachable entirely from chat.

## Phase 4 — Many voices

- An **ask** card addressed to a named stakeholder becomes an invite. The invite link opens the
  **Stakeholder interview** surface (the third and final surface): chat-only, no platform chrome,
  built on the existing sharing capability.
- The agent interviews each person separately, combines the answers, and raises contradictions as
  **flag** cards for the owner.
- Later: deliver invites through the Slack, Email and Google gatekeepers.

**Exit:** three stakeholders interviewed asynchronously on one process, with conflicts surfaced and
resolved in the owner's session.

## Phase 5 — Evidence-grounded mapping

- Connect sources through existing gatekeepers and MCP endpoints with deliberately scoped
  permissions (tickets, mail threads, database or Worker logs).
- The agent compares the map against the evidence and flags differences ("the map has 3 hand-offs;
  the email trail shows 7"), with the evidence attached to the step.

**Exit:** one real connector produces evidence-backed annotations on a map.

## Phase 6 — The map becomes running software

- Sign-off offers "Build it": the approved target process becomes a Cloudflare OS gadget or a
  Cloudflare Workflow, generated by the Workshop agent from the hand-off package.
- Monitoring compares outcome targets against real telemetry (the observability gatekeeper) and
  replaces the placeholder Monitor stage.

**Exit:** a simple approved process runs on Cloudflare and reports measured outcomes back into its
project.

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
