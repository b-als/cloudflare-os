import { describe, expect, it } from 'vitest'
import type { ApplyResult, OpBatch, ProjectSnapshot } from '@gadgets/gatekeeper-process/ui-types'
import { OpQueue, type QueueView } from './opQueue'
import { emptyLifecycle } from '@gadgets/gatekeeper-process/lifecycle'

function snapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    projectId: 'p1',
    name: 'Onboarding',
    graph: { revision: 3, lanes: [{ id: 'lane-a', label: 'Sales' }], nodes: [], edges: [] },
    decisions: [],
    openQuestions: [],
    stakeholders: [],
    interviewTargetStakeholderId: null,
    takeaways: [],
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function harness(initial = snapshot()) {
  const sent: Array<{ batch: OpBatch; reply: ReturnType<typeof deferred<ApplyResult>> }> = []
  const views: QueueView[] = []
  let ids = 0
  const queue = new OpQueue(
    initial,
    (batch) => {
      const reply = deferred<ApplyResult>()
      sent.push({ batch, reply })
      return reply.promise
    },
    (view) => views.push(view),
    () => `op-${++ids}`,
  )
  return { queue, sent, views }
}

const addStep = (id: string) => [{ op: 'addNode' as const, node: { id, type: 'userTask' as const, label: id, laneId: 'lane-a' } }]
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('OpQueue', () => {
  it('streams lifecycle and review updates without replacing the original graph', () => {
    const lifecycle = emptyLifecycle(3)
    const { queue } = harness(snapshot({ lifecycle }))
    const edited = { ...lifecycle, contentRevision: 4, artifacts: [{
      kind: 'stakeholder' as const, id: 'owner', title: 'Operations', role: 'Owner', notes: '',
    }] }
    queue.applyRemote({ revision: 4, source: 'user', ops: [], lifecycle: edited })
    expect(queue.view.snapshot.lifecycle).toEqual(edited)
    expect(queue.view.snapshot.graph.lanes).toEqual([{ id: 'lane-a', label: 'Sales' }])
    queue.applyRemote({ revision: 5, source: 'user', ops: [], lifecycle: edited })
    expect(queue.view.revision).toBe(5)
    expect(queue.view.snapshot.lifecycle?.contentRevision).toBe(4)
    queue.applyRemote({ revision: 6, source: 'user', ops: addStep('n1') })
    expect(queue.view.snapshot.lifecycle?.contentRevision).toBe(6)
    expect(queue.view.snapshot.lifecycle?.artifacts).toHaveLength(1)
  })

  it('applies edits optimistically before the server confirms', () => {
    const { queue, sent } = harness()
    expect(queue.apply(addStep('n1'))).toEqual({ ok: true })
    expect(queue.view.snapshot.graph.nodes.map((n) => n.id)).toEqual(['n1'])
    expect(queue.view.saveStatus).toBe('saving')
    expect(sent).toHaveLength(1)
    expect(sent[0].batch).toMatchObject({ clientOpId: 'op-1', baseRevision: 3 })
  })

  it('rejects invalid or locked edits locally without sending', () => {
    const { queue, sent } = harness(
      snapshot({
        graph: {
          revision: 1,
          lanes: [{ id: 'lane-a', label: 'Sales' }],
          nodes: [{ id: 'n1', type: 'userTask', label: 'Call', laneId: 'lane-a', x: 0, y: 0 }],
          edges: [],
        },
        decisions: [{ decisionId: 'd1', summary: 's', rationale: 'r', nodeIds: ['n1'], edgeIds: [], locked: true, status: 'active', decidedAt: 0 }],
      }),
    )
    expect(queue.apply([{ op: 'deleteNode', id: 'n1' }]).ok).toBe(false)
    expect(queue.apply([{ op: 'deleteLane', id: 'missing' }]).ok).toBe(false)
    expect(queue.apply([{ op: 'moveNode', id: 'n1', x: 10, y: 10 }]).ok).toBe(true)
    expect(sent).toHaveLength(1)
  })

  it('serializes batches and advances baseRevision on confirm', async () => {
    const { queue, sent } = harness()
    queue.apply(addStep('n1'))
    queue.apply(addStep('n2'))
    queue.apply(addStep('n3'))
    expect(sent).toHaveLength(1)
    sent[0].reply.resolve({ ok: true, revision: 4 })
    await settle()
    expect(sent).toHaveLength(2)
    expect(sent[1].batch.baseRevision).toBe(4)
    expect(sent[1].batch.clientOpId).not.toBe(sent[0].batch.clientOpId)
    expect(sent[1].batch.ops).toHaveLength(2)
    expect(queue.view.saveStatus).toBe('saving')
    sent[1].reply.resolve({ ok: true, revision: 5 })
    await settle()
    expect(queue.view.revision).toBe(5)
    expect(queue.view.saveStatus).toBe('saved')
    expect(queue.view.snapshot.graph.nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3'])
  })

  it('replaces state with the server snapshot on conflict', async () => {
    const { queue, sent } = harness()
    queue.apply(addStep('n1'))
    queue.apply(addStep('n2'))
    const latest = snapshot({ graph: { revision: 7, lanes: [{ id: 'lane-b', label: 'Ops' }], nodes: [], edges: [] } })
    sent[0].reply.resolve({ ok: false, reason: 'Node changed by someone else.', snapshot: latest })
    await settle()
    expect(sent).toHaveLength(1)
    expect(queue.view.saveStatus).toBe('conflict')
    expect(queue.view.error).toBe('Node changed by someone else.')
    expect(queue.view.revision).toBe(7)
    expect(queue.view.snapshot.graph.lanes.map((l) => l.id)).toEqual(['lane-b'])
  })

  it('keeps edits after a failed save and resends them on retry', async () => {
    const { queue, sent } = harness()
    queue.apply(addStep('n1'))
    sent[0].reply.reject(new Error('Network down'))
    await settle()
    expect(queue.view.saveStatus).toBe('error')
    expect(queue.view.error).toBe('Network down')
    expect(queue.view.snapshot.graph.nodes.map((n) => n.id)).toEqual(['n1'])
    queue.retry()
    expect(sent).toHaveLength(2)
    expect(sent[1].batch).toMatchObject({ baseRevision: 3, ops: addStep('n1') })
    sent[1].reply.resolve({ ok: true, revision: 4 })
    await settle()
    expect(queue.view.saveStatus).toBe('saved')
    expect(queue.view.revision).toBe(4)
  })

  it('applies remote changes, decisions, and questions to the confirmed state', () => {
    const { queue, views } = harness()
    const decision = { decisionId: 'd1', summary: 's', rationale: 'r', nodeIds: ['r1'], edgeIds: [], locked: true, status: 'active' as const, decidedAt: 1 }
    const stakeholder = {
      stakeholderId: 's1', name: 'Elena', role: 'KYC', stance: 'champion' as const, userId: 'u1',
    }
    queue.applyRemote({ revision: 4, source: 'user', clientOpId: 'other', ops: addStep('r1') })
    queue.applyRemote({ revision: 5, source: 'user', ops: [], decision })
    queue.applyRemote({ revision: 6, source: 'agent', ops: [], questionRaised: {
      questionId: 'q1', text: '?', nodeIds: [], raisedAt: 2, assigneeStakeholderId: 's1',
    } })
    queue.applyRemote({ revision: 7, source: 'agent', ops: [], stakeholderUpserted: stakeholder })
    queue.applyRemote({ revision: 8, source: 'agent', ops: [], interviewTargetChanged: { stakeholderId: 's1' } })
    expect(queue.view.revision).toBe(8)
    expect(queue.view.snapshot.graph.nodes.map((n) => n.id)).toEqual(['r1'])
    expect(queue.view.snapshot.openQuestions.map((q) => q.questionId)).toEqual(['q1'])
    expect(queue.view.snapshot.stakeholders).toEqual([stakeholder])
    expect(queue.view.snapshot.interviewTargetStakeholderId).toBe('s1')
    expect(views).toHaveLength(5)
    expect(queue.apply([{ op: 'deleteNode', id: 'r1' }]).ok).toBe(false)
    queue.applyRemote({ revision: 9, source: 'user', ops: [], decision: { ...decision, decisionId: 'd2', nodeIds: [] }, supersededDecisionIds: ['d1'] })
    queue.applyRemote({ revision: 10, source: 'user', ops: [], questionResolved: { questionId: 'q1', answer: 'yes' } })
    queue.applyRemote({ revision: 11, source: 'agent', ops: [], stakeholderRemoved: { stakeholderId: 's1' } })
    expect(queue.view.snapshot.decisions.map((d) => [d.decisionId, d.status])).toEqual([['d2', 'active'], ['d1', 'superseded']])
    expect(queue.view.snapshot.openQuestions).toEqual([])
    expect(queue.view.snapshot.stakeholders).toEqual([])
    expect(queue.view.snapshot.interviewTargetStakeholderId).toBeNull()
    expect(queue.apply([{ op: 'deleteNode', id: 'r1' }]).ok).toBe(true)
  })

  it('ignores stale and duplicate revisions', () => {
    const { queue, views } = harness()
    queue.applyRemote({ revision: 3, source: 'user', ops: addStep('old') })
    queue.applyRemote({ revision: 4, source: 'user', ops: addStep('r1') })
    queue.applyRemote({ revision: 4, source: 'user', ops: addStep('r1') })
    expect(queue.view.revision).toBe(4)
    expect(queue.view.snapshot.graph.nodes.map((n) => n.id)).toEqual(['r1'])
    expect(views).toHaveLength(1)
  })

  it('treats the echo of its own batch as confirmation and ignores the later result', async () => {
    const { queue, sent } = harness()
    queue.apply(addStep('n1'))
    queue.apply(addStep('n2'))
    queue.applyRemote({ revision: 4, source: 'user', clientOpId: 'op-1', ops: addStep('n1') })
    expect(queue.view.revision).toBe(4)
    expect(queue.view.snapshot.graph.nodes.map((n) => n.id)).toEqual(['n1', 'n2'])
    expect(sent).toHaveLength(1)
    sent[0].reply.resolve({ ok: true, revision: 4 })
    await settle()
    expect(sent).toHaveLength(2)
    expect(sent[1].batch).toMatchObject({ baseRevision: 4, ops: addStep('n2') })
    expect(queue.view.snapshot.graph.nodes.map((n) => n.id)).toEqual(['n1', 'n2'])
  })

  it('rebases unsaved edits over remote changes', async () => {
    const { queue, sent } = harness()
    queue.apply(addStep('n1'))
    queue.apply(addStep('n2'))
    queue.applyRemote({ revision: 4, source: 'user', clientOpId: 'other', ops: addStep('r1') })
    expect(queue.view.revision).toBe(4)
    expect(queue.view.saveStatus).toBe('saving')
    expect(queue.view.snapshot.graph.nodes.map((n) => n.id)).toEqual(['r1', 'n1', 'n2'])
    // Committed after the remote change; its echo follows.
    sent[0].reply.resolve({ ok: true, revision: 5 })
    await settle()
    expect(queue.view.revision).toBe(5)
    expect(sent).toHaveLength(2)
    expect(sent[1].batch).toMatchObject({ baseRevision: 5, ops: addStep('n2') })
    queue.applyRemote({ revision: 5, source: 'user', clientOpId: 'op-1', ops: addStep('n1') })
    sent[1].reply.resolve({ ok: true, revision: 6 })
    await settle()
    expect(queue.view.saveStatus).toBe('saved')
    expect(queue.view.snapshot.graph.nodes.map((n) => n.id)).toEqual(['r1', 'n1', 'n2'])
  })

  it('waits for the echo when the server skipped revisions it has not delivered yet', async () => {
    const { queue, sent } = harness()
    queue.apply(addStep('n1'))
    queue.apply(addStep('n2'))
    sent[0].reply.resolve({ ok: true, revision: 5 })
    await settle()
    expect(queue.view.revision).toBe(3)
    expect(sent).toHaveLength(1)
    queue.applyRemote({ revision: 4, source: 'user', ops: addStep('r1') })
    queue.applyRemote({ revision: 5, source: 'user', clientOpId: 'op-1', ops: addStep('n1') })
    expect(queue.view.revision).toBe(5)
    expect(queue.view.snapshot.graph.nodes.map((n) => n.id)).toEqual(['r1', 'n1', 'n2'])
    expect(sent).toHaveLength(2)
    expect(sent[1].batch).toMatchObject({ baseRevision: 5, ops: addStep('n2') })
  })

  it('drops unsaved edits that no longer apply after a remote change', () => {
    const { queue } = harness(
      snapshot({
        graph: {
          revision: 3,
          lanes: [{ id: 'lane-a', label: 'Sales' }],
          nodes: [{ id: 'n1', type: 'userTask', label: 'Call', laneId: 'lane-a', x: 0, y: 0 }],
          edges: [],
        },
      }),
    )
    queue.apply([{ op: 'updateNode', id: 'n1', label: 'Phone' }])
    queue.applyRemote({ revision: 4, source: 'user', ops: [{ op: 'deleteNode', id: 'n1' }] })
    expect(queue.view.saveStatus).toBe('conflict')
    expect(queue.view.error).toMatch(/discarded/)
    expect(queue.view.snapshot.graph.nodes).toEqual([])
    expect(queue.view.revision).toBe(4)
  })

  it('replaces state on reset and ignores older snapshots', () => {
    const { queue } = harness()
    queue.apply(addStep('n1'))
    const latest = snapshot({ name: 'Renamed', graph: { revision: 9, lanes: [], nodes: [], edges: [] } })
    queue.reset(latest)
    expect(queue.view.revision).toBe(9)
    expect(queue.view.snapshot.name).toBe('Renamed')
    expect(queue.view.snapshot.graph.nodes).toEqual([])
    expect(queue.view.saveStatus).toBe('saved')
    queue.reset(snapshot())
    expect(queue.view.revision).toBe(9)
  })
})
