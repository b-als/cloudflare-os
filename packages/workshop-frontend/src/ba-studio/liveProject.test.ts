import { describe, expect, it } from 'vitest'
import type { BaArtifact, ProcessGraph } from '@gadgets/gatekeeper-process/types'
import type { ProjectSnapshot } from '@gadgets/gatekeeper-process/ui-types'
import { toBpmnXml, toUserStoriesMarkdown } from './exports'
import { liveProjectView } from './liveProject'

const asIs: ProcessGraph = {
  revision: 3,
  lanes: [{ id: 'lane-ap', label: 'Accounts payable' }],
  nodes: [
    { id: 'start', type: 'startEvent', label: 'Invoice arrives', laneId: 'lane-ap', x: 0, y: 0 },
    {
      id: 'code', type: 'userTask', label: 'Code the invoice', laneId: 'lane-ap', x: 200, y: 0,
      owner: 'AP clerk', painPoints: 'Re-key the PO number', inputs: ['Invoice'], outputs: ['Coded invoice'],
      duration: { amount: 2, unit: 'hours' },
    },
    { id: 'end', type: 'endEvent', label: 'Paid', laneId: 'lane-ap', x: 400, y: 0 },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'code', label: 'Received' },
    { id: 'e2', source: 'code', target: 'end', label: 'No PO' },
  ],
}

const artifacts: BaArtifact[] = [
  {
    kind: 'outcome', id: 'o1', title: 'Faster coding', metric: 'Cycle time', unit: 'hours',
    baseline: 48, target: 8, direction: 'decrease', statement: 'Invoices sit too long before coding.', due: '2026-12-01',
  },
  {
    kind: 'stakeholder', id: 's1', title: 'AP clerk', role: 'AP clerk', notes: 'Codes invoices',
    influence: 4, interest: 5, stance: 'supporter',
  },
  {
    kind: 'requirement', id: 'r1', title: 'Match PO', statement: 'Match the invoice to a PO',
    priority: 'must', acceptanceCriteria: ['PO number present'], outcomeIds: ['o1'], stakeholderIds: ['s1'],
    nodeIds: ['t-code'], source: 'Interview',
  },
  {
    kind: 'requirement', id: 'r-out', title: 'Skip tax', statement: 'Tax is out of scope',
    priority: 'wont', acceptanceCriteria: [], outcomeIds: [], stakeholderIds: [], nodeIds: [], source: 'Sponsor',
  },
  {
    kind: 'tradeoff', id: 't1', title: 'Matching approach', options: ['Manual', 'Automatic'],
    selection: 'Automatic', rationale: 'Fewer re-keys', requirementIds: ['r1'],
  },
  {
    kind: 'finding', id: 'f1', title: 'No owner on the exception', scenarioId: 'sc1',
    severity: 'advisory', status: 'open', resolution: '',
  },
  {
    kind: 'measurement', id: 'm1', title: 'Week 1', outcomeId: 'o1', value: 40,
    measuredAt: 1_700_000_000_000, source: 'Ops report',
  },
  {
    kind: 'handoff', id: 'h1', title: 'PO matcher', owner: 'Platform', description: 'Match invoices to POs',
    requirementIds: ['r1'], status: 'planned',
  },
]

function snapshot(extra: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    projectId: 'project-1',
    name: 'Invoice approval',
    graph: asIs,
    decisions: [],
    openQuestions: [{ questionId: 'q1', text: 'Who signs off exceptions?', nodeIds: [], raisedAt: 1 }],
    stakeholders: [],
    interviewTargetStakeholderId: null,
    takeaways: [],
    lifecycle: {
      contentRevision: 3,
      artifacts,
      toBe: {
        revision: 1,
        lanes: [{ id: 'lane-ap', label: 'Accounts payable' }],
        nodes: [{ id: 't-code', type: 'userTask', label: 'Code the invoice', laneId: 'lane-ap', x: 0, y: 0, owner: 'AP clerk', duration: { amount: 30, unit: 'minutes' } }],
        edges: [],
      },
      baselines: [{
        id: 'b1', createdAt: 1_700_000_100_000, content: {
          projectId: 'project-1', name: 'Invoice approval', revision: 3, asIs, toBe: { revision: 0, lanes: [], nodes: [], edges: [] },
          artifacts: artifacts.slice(0, 2), decisions: [], openQuestions: [],
        },
        review: { decision: 'approved', accountId: 'owner', at: 1_700_000_200_000, note: 'Sponsor accepted the pilot.' },
      }],
    },
    ...extra,
  }
}

describe('liveProjectView', () => {
  it('reads saved outcomes, stakeholders, scope and the current map', () => {
    const view = liveProjectView(snapshot(), 'workspace-1')
    expect(view.summary.id).toBe('workspace-1')
    expect(view.framing.problemStatement).toBe('Invoices sit too long before coding.')
    expect(view.framing.outcomes[0]?.smart).toEqual({
      specific: true, measurable: true, achievable: true, relevant: true, timeBound: true,
    })
    expect(view.stakeholderProfiles[0]).toMatchObject({ influence: 4, interest: 5, stance: 'supporter' })
    expect(view.framing.scopeIn).toEqual(['Match PO'])
    expect(view.framing.scopeOut).toEqual(['Skip tax'])
    expect(view.framing.assumptions).toEqual(['Who signs off exceptions?'])
    expect(view.sipoc.suppliers).toEqual(['Accounts payable'])
    expect(view.sipoc.inputs).toEqual(['Invoice'])
    expect(view.sipoc.customers).toEqual(['Paid'])
    expect(view.asIs.edges.find((edge) => edge.id === 'e2')?.isException).toBe(true)
    expect(view.asIs.edges.find((edge) => edge.id === 'e1')?.isException).toBe(false)
    expect(view.painPoints[0]).toMatchObject({ wasteType: 'rework', annualCost: 0, evidence: 'Re-key the PO number' })
    expect(view.asIs.nodes.find((node) => node.id === 'code')?.slaHours).toBe(2)
    expect(view.toBe.nodes.find((node) => node.id === 't-code')?.slaHours).toBe(0.5)
    expect(view.toBe.nodes.find((node) => node.id === 't-code')?.requirementIds).toEqual(['r1'])
  })

  it('derives RACI, trade-offs, findings, baselines and monitor series from saved records', () => {
    const view = liveProjectView(snapshot(), 'workspace-1')
    expect(view.bundle.requirements.raci).toEqual([
      { activityId: 't-code', responsible: ['s1'], accountable: 's1', consulted: [], informed: [] },
    ])
    expect(view.bundle.tradeoffRegister.preferredOptionId).toBe('t1:1')
    expect(view.bundle.conflictRegister.conflicts[0]?.decision.status).toBe('resolved')
    expect(view.summary.openConflicts).toBe(0)
    expect(view.findings[0]).toMatchObject({ severity: 'risk', resolved: false })
    expect(view.versions[0]).toMatchObject({ version: '1', status: 'baselined' })
    expect(view.versions[0]?.changes.some((change) => change.artifact === 'processStep' && change.kind === 'added')).toBe(true)
    expect(view.monitoring[0]?.points).toEqual([{ period: '2023-11-14', actual: 40 }])
    expect(view.framing.measures[0]?.source).toBe('Ops report')
    expect(view.buildTargets[0]?.coversNodeIds).toEqual(['t-code'])
    expect(view.decisionTables).toEqual([])
    expect(view.projections).toEqual([])
    expect(toBpmnXml(view)).toContain('t-code')
    expect(toUserStoriesMarkdown(view)).toContain('Match PO')
  })

  it('leaves SMART time-bound and the stakeholder grid unset until those fields are saved', () => {
    const bare = snapshot()
    bare.lifecycle = {
      contentRevision: 1,
      artifacts: [
        { kind: 'outcome', id: 'o1', title: 'Short', metric: '', unit: '', baseline: null, target: null, direction: 'increase' },
        { kind: 'stakeholder', id: 's1', title: 'Sponsor', role: 'Sponsor', notes: '' },
      ],
      toBe: { revision: 0, lanes: [], nodes: [], edges: [] },
      baselines: [],
    }
    const view = liveProjectView(bare, 'workspace-1')
    expect(view.framing.outcomes[0]?.smart.timeBound).toBe(false)
    expect(view.framing.outcomes[0]?.smart.measurable).toBe(false)
    expect(view.stakeholderProfiles[0]).toMatchObject({ influence: 3, interest: 3, stance: 'neutral' })
    expect(view.framing.problemStatement).toBe('No problem statement recorded yet.')
    expect(view.stageStatus.signoff).toBe('notStarted')
  })
})
