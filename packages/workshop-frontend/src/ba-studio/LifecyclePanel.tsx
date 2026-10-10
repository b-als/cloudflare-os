import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { validateBaseline, emptyLifecycle } from '@gadgets/gatekeeper-process/lifecycle'
import type { BaArtifact, BaBaseline, BaBaselineContent, BaLifecycle, LifecycleOp } from '@gadgets/gatekeeper-process/types'
import type { ProcessAccountUi, ProjectSnapshot } from '@gadgets/gatekeeper-process/ui-types'
import { reportIssue } from '../errorReporting'
import type { StageId } from './prototype'
import { downloadProjectPackage } from './liveExports'

type Field = { key: string; label: string; type?: 'number' | 'list' | 'select' | 'datetime-local' | 'date'; options?: string[] }
const FIELDS: Record<BaArtifact['kind'], Field[]> = {
  outcome: [
    { key: 'statement', label: 'Why this outcome matters' },
    { key: 'metric', label: 'Metric' }, { key: 'unit', label: 'Unit' },
    { key: 'baseline', label: 'Baseline', type: 'number' }, { key: 'target', label: 'Target', type: 'number' },
    { key: 'direction', label: 'Direction', type: 'select', options: ['increase', 'decrease'] },
    { key: 'due', label: 'Target date', type: 'date' },
  ],
  stakeholder: [
    { key: 'role', label: 'Role / accountability' }, { key: 'notes', label: 'Involvement and consultation notes' },
    { key: 'influence', label: 'Influence (1–5)', type: 'number' }, { key: 'interest', label: 'Interest (1–5)', type: 'number' },
    { key: 'stance', label: 'Stance', type: 'select', options: ['neutral', 'champion', 'supporter', 'sceptic'] },
  ],
  requirement: [
    { key: 'statement', label: 'Requirement statement' },
    { key: 'priority', label: 'Priority', type: 'select', options: ['must', 'should', 'could', 'wont'] },
    { key: 'acceptanceCriteria', label: 'Acceptance criteria (one per line)', type: 'list' },
    { key: 'outcomeIds', label: 'Outcome IDs (one per line)', type: 'list' },
    { key: 'stakeholderIds', label: 'Stakeholder IDs (one per line)', type: 'list' },
    { key: 'nodeIds', label: 'Target step IDs (one per line)', type: 'list' },
    { key: 'source', label: 'Source / evidence reference' },
  ],
  tradeoff: [
    { key: 'options', label: 'Alternatives (one per line)', type: 'list' },
    { key: 'selection', label: 'Selected alternative (exact text)' }, { key: 'rationale', label: 'Selection rationale' },
    { key: 'requirementIds', label: 'Requirement IDs (one per line)', type: 'list' },
  ],
  scenario: [
    { key: 'requirementIds', label: 'Requirement IDs (one per line)', type: 'list' },
    { key: 'pathNodeIds', label: 'Target path step IDs, in order (one per line)', type: 'list' },
    { key: 'expected', label: 'Expected result' }, { key: 'actual', label: 'Actual result / evidence' },
    { key: 'status', label: 'Result', type: 'select', options: ['untested', 'passed', 'failed'] },
  ],
  finding: [
    { key: 'scenarioId', label: 'Scenario ID (optional)' },
    { key: 'severity', label: 'Severity', type: 'select', options: ['blocking', 'advisory'] },
    { key: 'status', label: 'Status', type: 'select', options: ['open', 'resolved'] },
    { key: 'resolution', label: 'Resolution / evidence' },
  ],
  handoff: [
    { key: 'owner', label: 'Accountable delivery owner' }, { key: 'description', label: 'Implementation work and dependencies' },
    { key: 'requirementIds', label: 'Requirement IDs (one per line)', type: 'list' },
    { key: 'status', label: 'Status', type: 'select', options: ['planned', 'inProgress', 'done'] },
  ],
  measurement: [
    { key: 'outcomeId', label: 'Outcome ID' }, { key: 'value', label: 'Observed value', type: 'number' },
    { key: 'measuredAt', label: 'Measured at', type: 'datetime-local' }, { key: 'source', label: 'Actual measurement source' },
  ],
}

const INPUT_CLASS = 'w-full rounded border border-kumo-line bg-kumo-base px-2 py-1.5 text-sm text-kumo-default'
const BUTTON_CLASS = 'rounded border border-kumo-line px-3 py-1.5 text-sm hover:bg-kumo-tint disabled:opacity-50'
type ReviewStub = Awaited<ReturnType<RpcStub<ProcessAccountUi>['getProjectReview']>>
type LifecycleApi = Pick<RpcStub<AuthenticatedApi>, 'getGatekeeperApp'>

function choice<const T extends readonly string[]>(value: string, options: T): T[number] {
  for (const option of options) if (option === value) return option
  throw new Error(`Invalid choice "${value}".`)
}

function buildArtifact(kind: BaArtifact['kind'], artifactId: string, values: Record<string, string>): BaArtifact {
  const get = (key: string) => values[key]?.trim() ?? ''
  const list = (key: string) => get(key).split('\n').map((entry) => entry.trim()).filter(Boolean)
  const number = (key: string) => {
    if (!get(key)) throw new Error(`${key} needs a value.`)
    const value = Number(get(key))
    if (!Number.isFinite(value)) throw new Error(`${key} must be a finite number.`)
    return value
  }
  const common = { id: artifactId, title: get('title') }
  switch (kind) {
    case 'outcome': return {
      ...common, kind, metric: get('metric'), unit: get('unit'),
      baseline: get('baseline') ? number('baseline') : null, target: get('target') ? number('target') : null,
      direction: choice(get('direction'), ['increase', 'decrease']),
      ...(get('statement') ? { statement: get('statement') } : {}),
      ...(get('due') ? { due: get('due') } : {}),
    }
    case 'stakeholder': return {
      ...common, kind, role: get('role'), notes: get('notes'),
      ...(get('influence') ? { influence: number('influence') } : {}),
      ...(get('interest') ? { interest: number('interest') } : {}),
      stance: choice(get('stance') || 'neutral', ['neutral', 'champion', 'supporter', 'sceptic']),
    }
    case 'requirement': return {
      ...common, kind, statement: get('statement'), priority: choice(get('priority'), ['must', 'should', 'could', 'wont']),
      acceptanceCriteria: list('acceptanceCriteria'), outcomeIds: list('outcomeIds'),
      stakeholderIds: list('stakeholderIds'), nodeIds: list('nodeIds'), source: get('source'),
    }
    case 'tradeoff': return {
      ...common, kind, options: list('options'), selection: get('selection'),
      rationale: get('rationale'), requirementIds: list('requirementIds'),
    }
    case 'scenario': return {
      ...common, kind, requirementIds: list('requirementIds'), pathNodeIds: list('pathNodeIds'),
      expected: get('expected'), actual: get('actual'), status: choice(get('status'), ['untested', 'passed', 'failed']),
    }
    case 'finding': return {
      ...common, kind, scenarioId: get('scenarioId'), severity: choice(get('severity'), ['blocking', 'advisory']),
      status: choice(get('status'), ['open', 'resolved']), resolution: get('resolution'),
    }
    case 'handoff': return {
      ...common, kind, owner: get('owner'), description: get('description'), requirementIds: list('requirementIds'),
      status: choice(get('status'), ['planned', 'inProgress', 'done']),
    }
    case 'measurement': return {
      ...common, kind, outcomeId: get('outcomeId'), value: number('value'),
      measuredAt: new Date(get('measuredAt')).getTime(), source: get('source'),
    }
  }
}

function initialFields(kind: BaArtifact['kind'], artifact?: BaArtifact): Record<string, string> {
  const values: Record<string, string> = { title: artifact?.title ?? '' }
  for (const field of FIELDS[kind]) {
    values[field.key] = field.options?.[0] ?? ''
  }
  if (artifact) {
    for (const [key, value] of Object.entries(artifact)) {
      if (value === null) values[key] = ''
      else if (Array.isArray(value)) values[key] = value.join('\n')
      else values[key] = String(value)
    }
    if (artifact.kind === 'measurement') {
      const localTime = new Date(artifact.measuredAt - new Date(artifact.measuredAt).getTimezoneOffset() * 60_000)
      values.measuredAt = localTime.toISOString().slice(0, 16)
    }
  }
  return values
}

function ArtifactEditor({ kind, artifact, busy, lifecycle, onSave, onClose }: {
  kind: BaArtifact['kind']; artifact?: BaArtifact; busy: boolean; lifecycle: BaLifecycle
  onSave: (artifact: BaArtifact) => Promise<void>; onClose: () => void
}) {
  const [values, setValues] = useState(() => initialFields(kind, artifact))
  const [error, setError] = useState<string | null>(null)
  const [artifactId] = useState(() => artifact?.id ?? crypto.randomUUID())
  const references = (key: string) => {
    if (key === 'nodeIds' || key === 'pathNodeIds') {
      return lifecycle.toBe.nodes.map((node) => ({ id: node.id, label: node.label }))
    }
    const referenceKind = key === 'outcomeIds' || key === 'outcomeId' ? 'outcome' :
      key === 'stakeholderIds' ? 'stakeholder' : key === 'requirementIds' ? 'requirement' :
      key === 'scenarioId' ? 'scenario' : null
    return referenceKind ? lifecycle.artifacts.filter((entry) => entry.kind === referenceKind)
      .map((entry) => ({ id: entry.id, label: entry.title })) : null
  }
  return (
    <form className="space-y-3 rounded-lg border border-kumo-line bg-kumo-elevated p-4" onSubmit={async (event) => {
      event.preventDefault()
      setError(null)
      try { await onSave(buildArtifact(kind, artifactId, values)); onClose() }
      catch (caught) {
        reportIssue('ba-lifecycle.save', caught, { gatekeeperVendorId: 'process' })
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    }}>
      <p className="break-all text-xs text-kumo-subtle">Stable ID: {artifactId}</p>
      {[{ key: 'title', label: 'Title' }, ...FIELDS[kind]].map((field: Field) => (
        <div key={field.key} className="block text-xs text-kumo-subtle">
          {field.label}
          {references(field.key) && field.key !== 'pathNodeIds' ? (
            field.type === 'list' ? <span className="block space-y-1 rounded border border-kumo-line p-2">
              {!references(field.key)?.length && <span>Record the referenced artifacts or target steps first.</span>}
              {references(field.key)?.map((option) => {
                const selected = new Set((values[field.key] ?? '').split('\n').filter(Boolean))
                return <span key={option.id} className="flex items-center gap-2">
                  <input type="checkbox" disabled={busy} checked={selected.has(option.id)} aria-label={`${field.key}: ${option.label}`}
                    onChange={(event) => {
                      if (event.target.checked) selected.add(option.id)
                      else selected.delete(option.id)
                      setValues({ ...values, [field.key]: [...selected].join('\n') })
                    }} />
                  <span>{option.label} <span className="text-kumo-inactive">({option.id})</span></span>
                </span>
              })}
            </span> : <select aria-label={field.label} className={INPUT_CLASS} disabled={busy} value={values[field.key]}
              onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}>
              <option value="">Select a reference</option>
              {references(field.key)?.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          ) : field.type === 'select' ? (
            <select aria-label={field.label} className={INPUT_CLASS} value={values[field.key]} disabled={busy}
              onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}>
              {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          ) : field.type === 'number' || field.type === 'datetime-local' || field.type === 'date' ? (
            <input aria-label={field.label} className={INPUT_CLASS} type={field.type} step={field.type === 'number' ? 'any' : undefined}
              value={values[field.key]} disabled={busy}
              onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />
          ) : (
            <textarea aria-label={field.label} className={INPUT_CLASS} rows={field.type === 'list' ? 3 : 2}
              maxLength={4000} value={values[field.key]} disabled={busy}
              onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />
          )}
          {field.key === 'pathNodeIds' && <select className={INPUT_CLASS} disabled={busy} defaultValue=""
            aria-label="Append target step to scenario path" onChange={(event) => {
              if (event.target.value) setValues({
                ...values, pathNodeIds: [values.pathNodeIds, event.target.value].filter(Boolean).join('\n'),
              })
              event.target.value = ''
            }}>
            <option value="">Append a target step in walkthrough order</option>
            {references(field.key)?.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>}
        </div>
      ))}
      {error && <p role="alert" className="text-sm text-kumo-danger">{error}</p>}
      <div className="flex gap-2">
        <button className={BUTTON_CLASS} disabled={busy || !values.title?.trim()}>{busy ? 'Saving...' : 'Save artifact'}</button>
        <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </form>
  )
}

function Signoff({ snapshot, content, api, busy, createBaseline }: {
  snapshot: ProjectSnapshot; content: BaBaselineContent; api: LifecycleApi;
  busy: boolean; createBaseline: () => Promise<BaBaseline>;
}) {
  const [review, setReview] = useState<{ stub: ReviewStub } | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [note, setNote] = useState('')
  useEffect(() => {
    let cancelled = false
    let held: ReviewStub | undefined
    setReview(null)
    setReviewError(null)
    const load = async () => {
      const frame = await api.getGatekeeperApp('process')
      if (!frame) throw new Error('Connect your Process Studio account to review baselines.')
      using accountUi = frame.ui as RpcStub<ProcessAccountUi>
      const stub = await accountUi.getProjectReview(snapshot.projectId)
      if (cancelled) stub[Symbol.dispose]()
      else { held = stub; setReview({ stub }) }
    }
    load().catch((caught: unknown) => {
      reportIssue('ba-lifecycle.review.open', caught, { gatekeeperVendorId: 'process' })
      if (!cancelled) setReviewError(caught instanceof Error ? caught.message : String(caught))
    })
    return () => { cancelled = true; held?.[Symbol.dispose]() }
  }, [api, snapshot.projectId])
  const issues = validateBaseline(content)
  const baselines = snapshot.lifecycle?.baselines ?? []
  const act = async (action: () => Promise<unknown>) => {
    setError(null); setReviewing(true)
    try { await action() }
    catch (caught) {
      reportIssue('ba-lifecycle.review', caught, { gatekeeperVendorId: 'process' })
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally { setReviewing(false) }
  }
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Baseline review</h2>
      <p className="text-sm text-kumo-subtle">Captures are immutable. Only the creating connected account may sign off; stakeholder names do not grant approval authority.</p>
      <p className="text-sm text-kumo-subtle">Only committed project content is captured. Unapplied agent proposals are not included.</p>
      <p className="text-sm">{issues.length ? `${issues.length} completeness blockers in the current draft` : 'Current draft has no completeness blockers'}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-kumo-subtle">
        {issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}
      </ul>
      <button className={BUTTON_CLASS} disabled={busy || reviewing} onClick={() => void act(createBaseline)}>Capture baseline</button>
      {reviewError && <p className="text-sm text-kumo-subtle">{reviewError}</p>}
      {!reviewError && <p className="text-sm text-kumo-subtle">
        {review ? 'Owner review capability verified.' : 'Verifying owner review capability...'}
      </p>}
      <label className="block text-sm">Review note (required for rejection)
        <textarea className={INPUT_CLASS} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {baselines.toReversed().map((baseline) => {
        const blockers = validateBaseline(baseline.content)
        const stale = baseline.content.revision !== content.revision
        return <article key={baseline.id} className="space-y-2 rounded-lg border border-kumo-line p-3">
          <p className="text-sm font-medium">Revision {baseline.content.revision} · {new Date(baseline.createdAt).toLocaleString()}{stale ? ' · historical content' : ' · current content'}</p>
          <p className="break-all text-xs text-kumo-subtle">Baseline {baseline.id}</p>
          {baseline.review ? (
            <p className="break-all text-sm">{baseline.review.decision} · account {baseline.review.accountId} · {new Date(baseline.review.at).toLocaleString()}<br />{baseline.review.note}</p>
          ) : (
            <>
              <p className="text-sm">{blockers.length} approval blockers</p>
              <details className="text-sm"><summary>Captured completeness checks</summary>
                <ul>{blockers.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>
              </details>
              <div className="flex flex-wrap gap-2">
                <button className={BUTTON_CLASS} disabled={!review || busy || reviewing || blockers.length > 0}
                  onClick={() => void act(() => review!.stub.reviewBaseline(baseline.id, 'approved', note))}>Approve captured baseline</button>
                <button className={BUTTON_CLASS} disabled={!review || busy || reviewing || !note.trim()}
                  onClick={() => void act(() => review!.stub.reviewBaseline(baseline.id, 'rejected', note))}>Reject captured baseline</button>
              </div>
            </>
          )}
          <button className={BUTTON_CLASS} onClick={() => downloadProjectPackage(baseline.content, baseline)}>Download captured review package</button>
        </article>
      })}
      {error && <p role="alert" className="text-sm text-kumo-danger">{error}</p>}
    </section>
  )
}

/** Live, persisted lifecycle stages. No prototype data or simulated success actions are used. */
export default function LifecyclePanel({ stage, snapshot, api, busy, save, createBaseline }: {
  stage: StageId; snapshot: ProjectSnapshot; api: LifecycleApi; busy: boolean
  save: (ops: LifecycleOp[], baseRevision?: number) => Promise<void>; createBaseline: () => Promise<BaBaseline>
}) {
  const lifecycle = snapshot.lifecycle ?? emptyLifecycle(snapshot.graph.revision)
  const [editor, setEditor] = useState<{ kind: BaArtifact['kind']; artifact?: BaArtifact; baseRevision: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setEditor(null); setError(null) }, [stage])
  const content: BaBaselineContent = {
    projectId: snapshot.projectId, name: snapshot.name, revision: lifecycle.contentRevision,
    asIs: snapshot.graph, toBe: lifecycle.toBe, artifacts: lifecycle.artifacts,
    decisions: snapshot.decisions, openQuestions: snapshot.openQuestions,
  }
  if (stage === 'signoff') return <Signoff snapshot={snapshot} content={content} api={api} busy={busy} createBaseline={createBaseline} />
  const kinds: BaArtifact['kind'][] =
    stage === 'outcomes' ? ['outcome'] : stage === 'stakeholders' ? ['stakeholder'] :
    stage === 'requirements' ? ['requirement'] : stage === 'tradeoffs' ? ['tradeoff'] :
    stage === 'validate' ? ['scenario', 'finding'] : stage === 'handoff' ? ['handoff'] : ['measurement']
  const artifacts = lifecycle.artifacts.filter((artifact) => kinds.includes(artifact.kind))
  const approved = lifecycle.baselines.findLast((baseline) =>
    baseline.review?.decision === 'approved' && baseline.content.revision === lifecycle.contentRevision)
  return (
    <section className="space-y-4 text-kumo-default">
      <h2 className="text-lg font-semibold">{stage === 'validate' ? 'Validation scenarios and findings' : stage === 'monitor' ? 'Actual outcome measurements' : stage === 'handoff' ? 'Implementation handoff' : stage === 'tradeoffs' ? 'Trade-offs' : stage.charAt(0).toUpperCase() + stage.slice(1)}</h2>
      <p className="text-sm text-kumo-subtle">Artifacts save to this project's Cloudflare Durable Object. Use stable IDs below when linking evidence and traceability. The agent can maintain these records conversationally.</p>
      {stage === 'monitor' && <>
        <p className="text-sm text-kumo-subtle">No telemetry source is connected automatically. Enter only real observations with their source and measurement time.</p>
        {lifecycle.artifacts.filter((artifact) => artifact.kind === 'outcome').map((outcome) => {
          const latest = lifecycle.artifacts.filter((artifact) => artifact.kind === 'measurement')
            .filter((measurement) => measurement.outcomeId === outcome.id)
            .toSorted((a, b) => b.measuredAt - a.measuredAt)[0]
          const attained = latest && outcome.target !== null &&
            (outcome.direction === 'increase' ? latest.value >= outcome.target : latest.value <= outcome.target)
          return <div className="rounded border border-kumo-line p-3 text-sm" key={outcome.id}>
            <strong>{outcome.title}</strong> · baseline {outcome.baseline ?? 'not set'} · target {outcome.target ?? 'not set'} {outcome.unit}
            <p>{latest ? `Latest: ${latest.value} ${outcome.unit} · ${attained ? 'target attained' : 'target not established or not attained'} · ${latest.source}` : 'No measurements recorded'}</p>
          </div>
        })}
      </>}
      {stage === 'handoff' && <div className="space-y-2">
        <p className="text-sm">{approved ? 'Current content has an approved baseline.' : 'Current content is not signed off. Draft exports are not approved handoff packages.'}</p>
        <div className="flex gap-2">
          <button className={BUTTON_CLASS} onClick={() => downloadProjectPackage(content)}>Download live draft</button>
          <button className={BUTTON_CLASS} disabled={!approved} onClick={() => approved && downloadProjectPackage(approved.content, approved)}>Download approved handoff</button>
        </div>
        <p className="text-sm text-kumo-subtle">Delivery items track implementation work; this does not automatically deploy a workflow or infrastructure.</p>
      </div>}
      <div className="flex flex-wrap gap-2">
        {kinds.map((kind) => <button key={kind} className={BUTTON_CLASS} disabled={busy || !!editor}
          onClick={() => setEditor({ kind, baseRevision: snapshot.graph.revision })}>Add {kind}</button>)}
      </div>
      {editor && <ArtifactEditor key={editor.artifact?.id ?? editor.kind} {...editor} busy={busy}
        lifecycle={lifecycle}
        onSave={(artifact) => save([{ op: 'putArtifact', artifact }], editor.baseRevision)} onClose={() => setEditor(null)} />}
      {artifacts.map((artifact) => (
        <article className="space-y-2 rounded-lg border border-kumo-line p-3" key={artifact.id}>
          <h3 className="font-medium">{artifact.title}</h3>
          <p className="break-all text-xs text-kumo-subtle">{artifact.kind} · {artifact.id}</p>
          <dl className="grid gap-1 text-sm">
            {Object.entries(artifact).filter(([key]) => !['id', 'title', 'kind'].includes(key)).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[minmax(100px,1fr)_3fr] gap-3">
                <dt className="text-kumo-subtle">{key}</dt>
                <dd className="whitespace-pre-wrap break-all">{Array.isArray(value) ? value.join('\n') : value === null ? 'Not established' : String(value)}</dd>
              </div>
            ))}
          </dl>
          <div className="flex gap-2">
            <button className={BUTTON_CLASS} disabled={busy} onClick={() => setEditor({ kind: artifact.kind, artifact, baseRevision: snapshot.graph.revision })}>Edit</button>
            <button className={BUTTON_CLASS} disabled={busy} onClick={async () => {
              setError(null)
              try { await save([{ op: 'deleteArtifact', id: artifact.id }], snapshot.graph.revision) }
              catch (caught) {
                reportIssue('ba-lifecycle.delete', caught, { gatekeeperVendorId: 'process' })
                setError(caught instanceof Error ? caught.message : String(caught))
              }
            }}>Delete</button>
          </div>
        </article>
      ))}
      {!artifacts.length && <p className="text-sm text-kumo-subtle">No {kinds.join(' or ')} artifacts recorded yet.</p>}
      <details className="text-xs text-kumo-subtle">
        <summary>Available reference IDs</summary>
        <ul>{lifecycle.artifacts.map((artifact) => <li className="break-all" key={artifact.id}>{artifact.kind}: {artifact.title} · {artifact.id}</li>)}
          {lifecycle.toBe.nodes.map((node) => <li key={node.id}>target step: {node.label} · {node.id}</li>)}</ul>
      </details>
      {error && <p role="alert" className="text-sm text-kumo-danger">{error}</p>}
    </section>
  )
}
