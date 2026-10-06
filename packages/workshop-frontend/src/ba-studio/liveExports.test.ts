import { describe, expect, it } from 'vitest'
import type { BaBaseline, BaBaselineContent } from '@gadgets/gatekeeper-process/types'
import { projectPackage } from './liveExports'

const CONTENT: BaBaselineContent = {
  projectId: 'real-project', name: 'Actual process', revision: 7,
  asIs: { revision: 7, nodes: [], edges: [], lanes: [] },
  toBe: { revision: 2, nodes: [], edges: [], lanes: [] },
  artifacts: [{ kind: 'measurement', id: 'observed', title: 'Actual observation',
    outcomeId: 'business-outcome', value: 12, measuredAt: 1_700_000_000_000, source: 'Operations report' }],
  decisions: [], openQuestions: [],
}

describe('live project exports', () => {
  it('exports actual persisted values and explicitly labels draft/non-deployed status', () => {
    const exported = JSON.parse(projectPackage(CONTENT))
    expect(exported.schemaVersion).toBe('ba-project/v1')
    expect(exported.status).toBe('draft')
    expect(exported.content).toEqual(CONTENT)
    expect(exported.infrastructure.execution).toBe('Not deployed by this export')
    expect(exported.baselineId).toBeUndefined()
    expect(exported.review).toBeUndefined()
  })

  it('uses immutable approved content even if a caller passes a newer draft', () => {
    const baseline: BaBaseline = {
      id: 'immutable-baseline', createdAt: 1_700_000_000_000, content: CONTENT,
      review: { decision: 'approved', accountId: 'owner-account', at: 1_700_000_100_000, note: 'Reviewed evidence' },
    }
    const newer = { ...CONTENT, revision: 9, name: 'Unapproved newer draft' }
    const exported = JSON.parse(projectPackage(newer, baseline))
    expect(exported.status).toBe('approved')
    expect(exported.content).toEqual(CONTENT)
    expect(exported.review.accountId).toBe('owner-account')
    expect(exported.baselineId).toBe('immutable-baseline')
  })

  it('does not turn a captured rejection into an approval', () => {
    const baseline: BaBaseline = {
      id: 'rejected-baseline', createdAt: 1_700_000_000_000, content: CONTENT,
      review: { decision: 'rejected', accountId: 'owner-account', at: 1_700_000_100_000, note: 'Incomplete' },
    }
    expect(JSON.parse(projectPackage(CONTENT, baseline)).status).toBe('rejected')
  })
})
