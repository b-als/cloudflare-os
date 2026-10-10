---
description: "Use when changing BA Studio, BA Projects or Process Studio: the chat-first process-mapping experience, its routes, ba-studio React components, the process gatekeeper, the BA agent, process map/canvas, stages, phases, lifecycle records, or BA exports. Enforces the product charter: one conversation plus one live map, agent-led, no new tabs, stages, pages or drawers."
applyTo: "packages/workshop-frontend/src/ba-studio/**, packages/workshop-frontend/src/routes/ba-projects*, packages/workshop-frontend/src/routes/workflow-studio.tsx, packages/gatekeeper-process/**"
---
# BA Studio: chat-first guardrails

[docs/ba-studio-charter.md](../../docs/ba-studio-charter.md) is binding. The migration is
[plans/ba-chat-first.md](../../plans/ba-chat-first.md). Find the current phase there and stay
inside it.

## Before writing code

- Run the charter's **decision test**. If the change adds a route, tab, page, panel, drawer, modal,
  sidebar item, header control or chat card kind, **stop and ask the user**: it exceeds a budget
  and needs a decision-log entry first. Offer the conversational alternative.
- If the request is "add a screen or tab for X", the default answer is to make X something the agent
  asks, proposes or generates in the conversation.

## Rules

- **Agent first.** Build a capability as a process-gatekeeper method or agent action (see
  `packages/gatekeeper-process/src/types.d.ts`) before any UI. The UI is only the chat card or map
  preview that renders it.
- **Three card kinds**: `propose`, `ask`, `flag`, rendered inline in the conversation. Don't add
  kinds, side panels or a second chat.
- **No silent writes.** Agent edits to the map or to records go through the gatekeeper's approval
  queue and show as map previews until accepted.
- **No method jargon in UI copy.** BABOK, SIPOC, RACI, MoSCoW, BPMN, DMN and SMART belong in agent
  instructions and generated documents only.
- **Real or nothing.** No scripted agents, demo data, "preview" badges or "in the live version…"
  text on product paths. Fixtures live beside tests.
- **No help text explaining gestures.** If the UI needs instructions, redesign it or let the agent
  explain.
- **Reuse the platform.** Use workspaces for isolation, sharing for collaborators, the Workshop
  agent for chat, and gatekeepers/MCP for external data. Keep `workshop-backend` and
  `workshop-shared` diffs minimal (see the root AGENTS.md kernel rules).
- **Don't extend the legacy ten-stage UI** (`stages/*`, `stages.tsx`, `LifecyclePanel`, the
  Coverage, Decisions and Traceability drawers, the `$stage` route, `/workflow-studio`,
  `prototype.ts`). It is being removed. Fix it only when a bug blocks the core loop.
- **Deletion is progress.** When something replaces a legacy screen, delete that screen in the same
  change, and lower the budget ratchet (`ba-studio/surfaceBudget.test.ts`) when it exists.
- Load the `frontend-conventions` skill for React work, and `write-gatekeeper` for gatekeeper work.

## Done means

- The feature is reachable through the conversation, and works without visiting another screen.
- The charter's budgets still hold.
- Tests protect the user-visible behaviour. Run
  `pnpm --filter @gadgets/gatekeeper-process test:run` and
  `pnpm --filter @gadgets/workshop-frontend test:run` as relevant.
