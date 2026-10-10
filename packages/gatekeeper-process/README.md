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

That is all, on purpose. Each later phase of [the plan](../../plans/ba-chat-first.md) adds what it
needs when it starts, designed for the conversation.

## Two capabilities

- **The agent's session** (`startSession`) can read the map (each read is an observation) and
  propose changes with `applyChanges()`. Every proposal goes through the approval queue with
  `awaitDecision`, so the conversation waits for the person, and none is auto-approvable. The agent
  contract is [src/types.d.ts](src/types.d.ts), which is also the agent's instructions.
  [src/types.txt](src/types.txt) must be an exact copy (`scripts/gatekeeper-types.test.ts` checks).
- **The person's map** (`startUi`) reads the project, streams live changes, previews pending
  proposals (including the lanes a first draft adds), re-lays the map in flow order, and applies
  direct edits. An edit conflicts only if it touches a step or flow someone changed since the
  editor last saw it.

Steps the agent adds without coordinates are placed in flow order after their predecessors, so a
draft reads left to right without tidying.

## Projects from the retired ten-stage model

A project stored by that model is read once on first open: its map and its accepted current-state
decisions carry across, and nothing else does. That import is one function in
[src/project-do.ts](src/project-do.ts), to delete once no deployment holds such projects.

## Running the tests

```
pnpm --filter @gadgets/gatekeeper-process test:run
```
