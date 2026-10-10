# Process Studio

Process Studio is the persistent BA workspace behind the Workshop's **BA Projects**.
It runs as a Cloudflare Worker with a SQLite Durable Object per project. Workspace
sharing and direct-edit capabilities are provided by Cloudflare OS; it does not
introduce a second identity, collaboration, or agent system.

> **Direction:** BA Studio is chat-first: one conversation, one live map, and four agent-led
> phases instead of ten stage screens. See [docs/ba-studio-charter.md](../../docs/ba-studio-charter.md)
> and [plans/ba-chat-first.md](../../plans/ba-chat-first.md). The lifecycle records below remain
> the data model the agent writes; the per-stage screens were retired (tag `ba-ten-stage-archive`).

## Lifecycle

The ten project stages operate on live state:

- Outcomes: metrics, units, baseline values and targets.
- Stakeholders: roles and consultation notes. These records do not grant authority.
- Current state: the original process graph, including step detail and decision locks.
- Requirements: statements, MoSCoW priorities, acceptance criteria, source evidence,
  and stable-ID links to outcomes, stakeholders and target steps.
- Future state: a separate editable target graph. Copying the current graph is an
  explicit operation and does not overwrite it.
- Trade-offs: alternatives, selection, rationale and requirement links.
- Validate: persisted scenario paths, expected/actual results and findings.
- Sign-off: immutable captures and an owner-account review.
- Hand-off: delivery ownership, requirement-linked work items, and JSON packages
  exported from actual draft or captured approved content.
- Monitor: timestamped, sourced observations compared with outcome targets.

Existing projects retain their original graph as current state. Lifecycle data is
initialized lazily; the target graph starts empty. Direct lifecycle changes use
the same project revision and live subscription as canvas changes. Stale direct
edits fail explicitly rather than overwrite another editor's work.

Agents use [types.d.ts](src/types.d.ts). Artifact edits and target-model edits use
the existing approval queue, with simulation for subsequent agent reads. Human
review displays the proposed artifact contents. Conflicting proposals are surfaced
and fail if applied without resolving the conflict.

## Baseline authority

The workspace edit handle may capture a baseline but cannot approve it. The
authenticated Process account's management UI mints a separate review capability
only when its account ID matches the project's creating account. An agent session
has no method to mint or invoke this capability. Review identity is recorded as
the stable connected account ID, never an editable stakeholder name.

An approval requires both models to have starts, ends, reachable steps, paths to
an end, owned tasks and properly branched gateways. It also requires measurable
outcomes, stakeholders, traced requirements, passing evidenced validation scenarios,
resolved blocking findings and no unanswered questions. A rejected baseline
requires a reason. A capture can be reviewed only once; capture a new one for a
subsequent review. Historical captures remain immutable and identifiable.

Any later content change invalidates the current-content approved-handoff status;
the historical approval is retained. Measurements and delivery-status edits also
constitute content changes, so a new baseline is needed to approve the revised package.

Limits: 200 artifacts, 100 entries per reference/criteria list, 4000 characters per
text field, 20 immutable captures, and 2 MB of lifecycle JSON. These limits fail
explicitly. Remove references before deleting their artifacts or target steps.

## Infrastructure and deployment

[cloudflare.config.ts](cloudflare.config.ts) is the Worker configuration source;
[wrangler.jsonc](wrangler.jsonc) is generated. The existing `v1` namespace migrations
are preserved. Project state and review history use the project DO's SQLite-backed
storage; no separate D1 database or new cloud credentials are required.

The release manifest preinstalls Process Studio as an install-once, no-OAuth-input
gatekeeper, scoped to the Workshop's sharing domain. Local startup automatically
discovers it with `pnpm run-local` or `pnpm dev:local`.

This release does **not** deploy executable workflows or supply automatic telemetry.
Scenario results are recorded evidence, not an engine-generated execution trace.
JSON exports are implementation contracts, not a claim that implementation was
deployed. Connect external sources through the existing OS MCP/gatekeeper system
with deliberately scoped permissions. Cloudflare Workflows or R2 can be added when
actual durable execution or evidence attachments require them.

Run `pnpm --filter @gadgets/gatekeeper-process test:run` for graph, coverage,
Durable Object, simulation, migration and owner-review tests. Run `pnpm lint` from
the repository root before publishing.
